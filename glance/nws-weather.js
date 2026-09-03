(() => {
  "use strict";

  const SELECTOR = ".nws-weather:not([data-solar-initialized])";

  function validTimeZone(value) {
    if (!value) {
      return null;
    }

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return value;
    } catch {
      return null;
    }
  }

  function initializeSolar(root) {
    root.dataset.solarInitialized = "true";

    const latitude = Number(root.dataset.latitude);
    const longitude = Number(root.dataset.longitude);
    const timeZone =
      validTimeZone(root.dataset.timeZone) ||
      validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ||
      "UTC";
    const solarWrap = root.querySelector('[data-role="solar-wrap"]');
    const solarIcon = root.querySelector('[data-role="solar-icon"]');
    const solarTime = root.querySelector('[data-role="solar-time"]');
    const weatherSummary = root.getAttribute("aria-label") || "";

    if (!solarWrap || !solarIcon || !solarTime) {
      return;
    }

    function datePartsInTimeZone(date) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));

      return {
        year: values.year,
        month: values.month,
        day: values.day,
      };
    }

    function solarEventsForDate(year, month, day) {
      const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
      const fractionalYear = (2 * Math.PI * (dayOfYear - 1)) / 365;
      const equationOfTime =
        229.18 *
        (0.000075 +
          0.001868 * Math.cos(fractionalYear) -
          0.032077 * Math.sin(fractionalYear) -
          0.014615 * Math.cos(2 * fractionalYear) -
          0.040849 * Math.sin(2 * fractionalYear));
      const declination =
        0.006918 -
        0.399912 * Math.cos(fractionalYear) +
        0.070257 * Math.sin(fractionalYear) -
        0.006758 * Math.cos(2 * fractionalYear) +
        0.000907 * Math.sin(2 * fractionalYear) -
        0.002697 * Math.cos(3 * fractionalYear) +
        0.00148 * Math.sin(3 * fractionalYear);
      const latitudeRadians = (latitude * Math.PI) / 180;
      const zenithRadians = (90.833 * Math.PI) / 180;
      const hourAngleCosine =
        Math.cos(zenithRadians) / (Math.cos(latitudeRadians) * Math.cos(declination)) -
        Math.tan(latitudeRadians) * Math.tan(declination);

      if (hourAngleCosine < -1 || hourAngleCosine > 1) {
        return { sunrise: null, sunset: null };
      }

      const hourAngle = (Math.acos(hourAngleCosine) * 180) / Math.PI;
      const midnightUtc = Date.UTC(year, month - 1, day);
      const atUtcMinutes = (minutes) => new Date(midnightUtc + minutes * 60000);

      return {
        sunrise: atUtcMinutes(720 - 4 * (longitude + hourAngle) - equationOfTime),
        sunset: atUtcMinutes(720 - 4 * (longitude - hourAngle) - equationOfTime),
      };
    }

    function nextSolarEvent(now = new Date()) {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      const localDate = datePartsInTimeZone(now);
      const firstDate = Date.UTC(localDate.year, localDate.month - 1, localDate.day);
      const formatter = new Intl.DateTimeFormat([], {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      });

      for (let offset = 0; offset <= 370; offset += 1) {
        const candidateDate = new Date(firstDate + offset * 86400000);
        const events = solarEventsForDate(
          candidateDate.getUTCFullYear(),
          candidateDate.getUTCMonth() + 1,
          candidateDate.getUTCDate(),
        );
        const next = [
          events.sunrise && { type: "sunrise", date: events.sunrise },
          events.sunset && { type: "sunset", date: events.sunset },
        ]
          .filter(Boolean)
          .filter((event) => event.date > now)
          .sort((a, b) => a.date - b.date)[0];

        if (next) {
          return {
            ...next,
            time: formatter.format(next.date),
          };
        }
      }

      return null;
    }

    function renderSolar() {
      if (!root.isConnected) {
        return;
      }

      const event = nextSolarEvent();
      solarWrap.hidden = !event;

      if (!event) {
        return;
      }

      solarIcon.dataset.event = event.type;
      solarTime.textContent = event.time;
      solarWrap.title = `Next ${event.type} at ${event.time}`;
      root.setAttribute("aria-label", `${weatherSummary} Next ${event.type} at ${event.time}.`);

      const delay = Math.min(Math.max(event.date - Date.now() + 1000, 1000), 2147483647);
      window.setTimeout(renderSolar, delay);
    }

    renderSolar();
  }

  function initializeWithin(node) {
    if (!(node instanceof Element || node instanceof Document)) {
      return;
    }

    if (node instanceof Element && node.matches(SELECTOR)) {
      initializeSolar(node);
    }

    node.querySelectorAll(SELECTOR).forEach(initializeSolar);
  }

  function start() {
    initializeWithin(document);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach(initializeWithin);
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
