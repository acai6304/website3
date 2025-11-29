document.addEventListener("DOMContentLoaded", () => {
  const earthquakeUrl = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&limit=50";
  const weatherAlertsUrl = "https://api.weather.gov/alerts/active";
  const solarFlaresUrl = "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json";
  const kpIndexUrl = "https://services.swpc.noaa.gov/json/planetary_k_index_1_day.json";

  const earthquakeList = document.getElementById("earthquake-list");
  const alertList = document.getElementById("alert-list");
  const flareList = document.getElementById("flare-list");
  const kpList = document.getElementById("kp-list");
  const summaryBody = document.getElementById("summary-body");
  const errorBox = document.getElementById("error-box");
  const errorMessage = document.getElementById("error-message");
  const feedList = document.getElementById("feed-list");

  const filtersForm = document.getElementById("filters-form");
  const minMagInput = document.getElementById("min-mag");
  const modeSelect = document.getElementById("mode-select");
  const modeButtons = document.querySelectorAll(".mode-btn");
  const sections = {
    overview: document.getElementById("overview"),
    earth: document.getElementById("earth"),
    space: document.getElementById("space"),
  };

  let earthquakes = [];
  let alerts = [];
  let flares = [];
  let kpValues = [];
  let feedEvents = [];
  let feedIntervalId = null;

  const showError = (message) => {
    if (!message) {
      errorBox.classList.add("hidden");
      errorMessage.textContent = "";
      return;
    }
    errorBox.classList.remove("hidden");
    errorMessage.textContent = message;
  };

  const smoothNav = () => {
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute("href"));
        if (target) {
          window.scrollTo({
            top: target.offsetTop - 60,
            behavior: "smooth",
          });
        }
      });
    });
  };

  const fetchEarthquakes = async () => {
    try {
      const res = await fetch(earthquakeUrl);
      if (!res.ok) throw new Error("Failed to load earthquakes");
      const data = await res.json();
      earthquakes = (data.features || []).map((feature) => {
        const { mag, place, time } = feature.properties || {};
        const [lon, lat] = feature.geometry?.coordinates || [];
        return { mag, place, time, lat, lon };
      });
      updateEarthquakes();
    } catch (err) {
      console.error(err);
      showError("Unable to load earthquake data right now.");
      earthquakeList.innerHTML = "<li>Unable to load earthquakes.</li>";
    }
  };

  const fetchWeatherAlerts = async () => {
    try {
      const res = await fetch(weatherAlertsUrl);
      if (!res.ok) throw new Error("Failed to load alerts");
      const data = await res.json();
      alerts = (data.features || []).map((feature) => {
        const { event, areaDesc, effective } = feature.properties || {};
        return {
          event,
          area: areaDesc,
          time: effective || feature.properties?.sent,
        };
      });
      updateAlerts();
    } catch (err) {
      console.error(err);
      showError("Unable to load weather alerts right now.");
      alertList.innerHTML = "<li>Unable to load alerts.</li>";
    }
  };

  const fetchSolarFlares = async () => {
    try {
      const res = await fetch(solarFlaresUrl);
      if (!res.ok) throw new Error("Failed to load solar flares");
      const data = await res.json();
      flares = Array.isArray(data)
        ? data.map((item) => ({
            flux: item?.flux,
            time: item?.time_tag,
          }))
        : [];
      updateFlares();
    } catch (err) {
      console.error(err);
      showError("Unable to load solar flare data right now.");
      flareList.innerHTML = "<li>Unable to load solar flares.</li>";
    }
  };

  const fetchKpIndex = async () => {
    try {
      const res = await fetch(kpIndexUrl);
      if (!res.ok) throw new Error("Failed to load Kp index");
      const data = await res.json();
      kpValues = Array.isArray(data)
        ? data.map((item) => ({
            value: Number(item?.kp_index),
            time: item?.time_tag,
          }))
        : [];
      updateKp();
    } catch (err) {
      console.error(err);
      showError("Unable to load Kp index data right now.");
      kpList.innerHTML = "<li>Unable to load Kp index.</li>";
    }
  };

  const formatTime = (time) => {
    const date = new Date(time);
    return isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
  };

  const updateEarthquakes = () => {
    const minMag = Number(minMagInput.value) || 0;
    const filtered = earthquakes.filter((q) => (q.mag ?? 0) >= minMag);
    earthquakeList.innerHTML =
      filtered.length === 0
        ? "<li>No earthquakes match the filter.</li>"
        : filtered
            .map(
              (q) =>
                `<li><strong>M${q.mag?.toFixed(1) ?? "?"}</strong> - ${q.place || "Unknown location"}<div class="item-meta">${formatTime(q.time)}</div></li>`
            )
            .join("");
    updateSummary();
    refreshFeed();
  };

  const updateAlerts = () => {
    alertList.innerHTML =
      alerts.length === 0
        ? "<li>No active alerts.</li>"
        : alerts
            .map(
              (a) =>
                `<li><strong>${a.event || "Alert"}</strong> - ${a.area || "Unknown area"}<div class="item-meta">${formatTime(a.time)}</div></li>`
            )
            .join("");
    updateSummary();
    refreshFeed();
  };

  const updateFlares = () => {
    const sorted = flares
      .filter((f) => f.flux !== undefined)
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 10);
    flareList.innerHTML =
      sorted.length === 0
        ? "<li>No flare data available.</li>"
        : sorted
            .map(
              (f) =>
                `<li><strong>Flux:</strong> ${Number(f.flux).toExponential(2)} W/m²<div class="item-meta">${formatTime(f.time)}</div></li>`
            )
            .join("");
    updateSummary();
    refreshFeed();
  };

  const updateKp = () => {
    const sorted = kpValues
      .filter((k) => !Number.isNaN(k.value))
      .sort((a, b) => new Date(b.time) - new Date(a.time));
    kpList.innerHTML =
      sorted.length === 0
        ? "<li>No Kp data available.</li>"
        : sorted
            .slice(0, 10)
            .map(
              (k) =>
                `<li><strong>Kp:</strong> ${k.value}<div class="item-meta">${formatTime(k.time)}</div></li>`
            )
            .join("");
    updateSummary();
    refreshFeed();
  };

  const updateSummary = () => {
    const maxMag =
      earthquakes.reduce((max, q) => (q.mag && q.mag > max ? q.mag : max), 0) ||
      0;
    const alertCount = alerts.length;
    const maxKp =
      kpValues.reduce(
        (max, k) => (!Number.isNaN(k.value) && k.value > max ? k.value : max),
        0
      ) || 0;
    const flarePeak =
      flares.reduce(
        (max, f) => (!Number.isNaN(Number(f.flux)) && Number(f.flux) > max ? Number(f.flux) : max),
        0
      ) || 0;

    const rows = [
      {
        metric: "Largest Magnitude",
        value: maxMag ? `M${maxMag.toFixed(1)}` : "n/a",
        status: maxMag >= 6 ? "Strong quake observed" : "Stable",
      },
      {
        metric: "Active Weather Alerts",
        value: alertCount,
        status: alertCount > 0 ? "Alerts in effect" : "Clear",
      },
      {
        metric: "Peak Kp (24h)",
        value: maxKp,
        status: maxKp >= 5 ? "Geomagnetic storming" : "Quiet to active",
      },
      {
        metric: "Peak X-ray Flux",
        value: flarePeak ? `${flarePeak.toExponential(2)} W/m²` : "n/a",
        status: flarePeak > 0 ? "Solar flares detected" : "Calm",
      },
    ];

    summaryBody.innerHTML = rows
      .map(
        (row) =>
          `<tr><td>${row.metric}</td><td>${row.value}</td><td>${row.status}</td></tr>`
      )
      .join("");
  };

  const buildFeedEvents = () => {
    const eqEvents = earthquakes.slice(0, 20).map((q) => ({
      type: "earth",
      time: q.time,
      text: `M${q.mag?.toFixed(1) ?? "?"} quake - ${q.place || "Unknown"}`,
      target: "#earth",
    }));

    const alertEvents = alerts.slice(0, 15).map((a) => ({
      type: "weather",
      time: a.time,
      text: `${a.event || "Alert"} - ${a.area || "Unknown area"}`,
      target: "#earth",
    }));

    const flareEvents = flares.slice(0, 15).map((f) => ({
      type: "space",
      time: f.time,
      text: `Solar flare flux ${Number(f.flux).toExponential(2)} W/m²`,
      target: "#space",
    }));

    const kpEvents = kpValues.slice(0, 10).map((k) => ({
      type: "space",
      time: k.time,
      text: `Kp level ${k.value}`,
      target: "#space",
    }));

    feedEvents = [...eqEvents, ...alertEvents, ...flareEvents, ...kpEvents]
      .filter((e) => e.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time));
  };

  const refreshFeed = () => {
    buildFeedEvents();
    if (feedIntervalId) clearInterval(feedIntervalId);
    feedList.innerHTML = "";
    let index = 0;

    const appendNext = () => {
      if (feedEvents.length === 0) {
        feedList.innerHTML = "<li>No live events available.</li>";
        return;
      }
      const event = feedEvents[index % feedEvents.length];
      const li = document.createElement("li");
      li.textContent = `${formatTime(event.time)} — ${event.text}`;
      li.dataset.target = event.target;
      li.addEventListener("click", () => {
        document.querySelectorAll("#feed-list li").forEach((n) => n.classList.remove("active"));
        li.classList.add("active");
        const target = document.querySelector(event.target);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      feedList.prepend(li);
      index += 1;
    };

    appendNext();
    feedIntervalId = setInterval(appendNext, 4000);
  };

  const handleFilters = (e) => {
    e.preventDefault();
    updateEarthquakes();
    const mode = modeSelect.value;
    if (mode === "earth") toggleMode("earth");
    if (mode === "space") toggleMode("space");
    if (mode === "all") toggleMode("overview");
  };

  const toggleMode = (mode) => {
    Object.keys(sections).forEach((key) => {
      if (mode === "overview") {
        sections[key].classList.remove("hidden");
      } else if (key === mode) {
        sections[key].classList.remove("hidden");
      } else {
        sections[key].classList.add("hidden");
      }
    });
  };

  const initModeButtons = () => {
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        toggleMode(mode);
      });
    });
  };

  const init = async () => {
    smoothNav();
    initModeButtons();
    filtersForm.addEventListener("submit", handleFilters);
    await Promise.all([
      fetchEarthquakes(),
      fetchWeatherAlerts(),
      fetchSolarFlares(),
      fetchKpIndex(),
    ]);
    updateSummary();
  };

  init();
});
