window.HOMEPAGE_NWS_WEATHER = {
  latitude: 39.7456,
  longitude: -97.0892,
  locationLabel: "Home",
  units: "us",
  position: "center",
};

(() => {
  if (document.querySelector('script[data-homepage-nws-weather]')) {
    return;
  }

  const script = document.createElement("script");
  script.src = "/nws-weather.js?v=0.1.3";
  script.defer = true;
  script.dataset.homepageNwsWeather = "true";
  document.head.appendChild(script);
})();
