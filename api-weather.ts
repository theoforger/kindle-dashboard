import express from "express";
import sharp from "sharp";
import path from "path";
import * as lucideIcons from "lucide-static";
import fs from "fs";
import { chromium } from "playwright";

const DASHBOARD_WIDTH = 1448;
const DASHBOARD_HEIGHT = 1072;
const PORT = 8080; // Different from the other weather server
const PUBLIC_DIR = path.join(process.cwd(), "public");

const LANGUAGE = process.env.LANGUAGE === "fr" ? "fr" : "en";
const TIMEZONE = process.env.TIMEZONE ?? "America/Edmonton";
const WEATHER_LOCATION = {
  lat: process.env.LATITUDE ? parseFloat(process.env.LATITUDE) : 50.041,
  lon: process.env.LONGITUDE ? parseFloat(process.env.LONGITUDE) : -110.677,
};

// Weather icon mapping to Lucide static SVG strings
// Best guess Environment Canada icons to Lucide icons
const WEATHER_ICONS: { [key: string]: string } = {
  "00": lucideIcons.Sun, // Sunny
  "01": lucideIcons.SunMedium, // Mainly Sunny
  "02": lucideIcons.CloudSun, // A mix of sun and cloud
  "03": lucideIcons.Cloud, // Mainly cloudy
  "10": lucideIcons.Cloud, // Cloudy/Overcast
  "16": lucideIcons.CloudSnow, // Light Snow/Chance of flurries
  "23": lucideIcons.Haze, // Haze
  "26": lucideIcons.Snowflake, // Ice Crystals
  "30": lucideIcons.Moon, // Clear (night)
  "31": lucideIcons.MoonStar, // Mainly Clear/A few clouds (night)
  "32": lucideIcons.CloudMoon, // Partly cloudy (night)
  // Keeping other existing mappings
  "04": lucideIcons.CloudRain, // Light Rain
  "06": lucideIcons.CloudRainWind, // Rain
  "07": lucideIcons.CloudSnow, // Light Snow
  "08": lucideIcons.CloudSnow, // Snow
  "11": lucideIcons.CloudFog, // Fog
  "12": lucideIcons.CloudRain, // Showers
  "13": lucideIcons.CloudRainWind, // Rain and Snow Mixed
  "14": lucideIcons.CloudDrizzle, // Light Drizzle
  "15": lucideIcons.CloudRainWind, // Rain or Snow
  "17": lucideIcons.CloudLightning, // Thunderstorm
  "18": lucideIcons.CloudHail, // Hail
  "19": lucideIcons.CloudSunRain, // Mixed Rain and Sun
  "24": lucideIcons.Wind, // Blowing Snow
  "25": lucideIcons.Tornado, // Funnel Cloud
  "27": lucideIcons.CloudSnow, // Blowing Snow
  "28": lucideIcons.CloudFog, // Dense Fog
  "29": lucideIcons.CloudSun, // Variable Cloudiness
  "33": lucideIcons.CloudMoonRain, // Rain Showers Night
  "34": lucideIcons.CloudSnow, // Snow Night
  "35": lucideIcons.CloudLightning, // Thunderstorm Night
  "36": lucideIcons.CloudDrizzle, // Drizzle Night
  "37": lucideIcons.CloudFog, // Fog Night
  "38": lucideIcons.CloudMoon, // Cloudy Night
  "39": lucideIcons.CloudRainWind, // Rain Night
  "40": lucideIcons.Thermometer, // Hot
  "41": lucideIcons.ThermometerSnowflake, // Cold
  "42": lucideIcons.Waves, // Humidity
  "43": lucideIcons.Wind, // Wind
  // Battery
  "44": lucideIcons.Battery, // Battery EMPTY
  "45": lucideIcons.BatteryMedium, // Battery MEDIUM
  "46": lucideIcons.BatteryFull, // Battery FULL
  "47": lucideIcons.BatteryLow, // Battery LOW
};

function getIconSvg(iconCode: string, size: number = 64): string {
  let svgString = WEATHER_ICONS[iconCode];
  if (!svgString) {
    console.warn(`Icon code ${iconCode} not found, defaulting to Cloud`);
    svgString = WEATHER_ICONS["02"];
  }
  svgString = svgString
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}"`)
    .replace(/stroke="currentColor"/, `stroke="black"`);
  return svgString;
}

function formatDateTime() {
  const date = new Date();
  return date
    .toLocaleString(`${LANGUAGE}-CA`, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIMEZONE,
      hour12: LANGUAGE === "en",
    })
    .replace(",", " |");
}

function getBatteryIcon(percentage: number): string {
  if (percentage < 2) return getIconSvg("44", 48); // Battery EMPTY
  if (percentage < 10) return getIconSvg("47", 48); // Battery LOW
  if (percentage > 90) return getIconSvg("46", 48); // Battery FULL
  return getIconSvg("45", 48); // Battery MEDIUM
}

async function fetchWeatherData() {
  try {
    const response = await fetch(
      `https://weather.gc.ca/api/app/${LANGUAGE}/Location/${WEATHER_LOCATION.lat},${WEATHER_LOCATION.lon}?type=city`,
      {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Cache-Control": "max-age=0,no-cache",
          Pragma: "no-cache",
          Referer: `https://weather.gc.ca/${LANGUAGE}/location/index.html?coords=${WEATHER_LOCATION.lat},${WEATHER_LOCATION.lon}`,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching weather data:", error);
    throw error;
  }
}

export async function captureWeatherScreenshot(batteryPercentage: number) {
  console.log("Starting screenshot capture...");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: {
      width: DASHBOARD_WIDTH,
      height: DASHBOARD_HEIGHT,
    },
  });

  try {
    // First create the HTML file
    const weatherData = await fetchWeatherData();
    await createWeatherImage(weatherData, batteryPercentage);

    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/dashapi.html`);

    // Wait for the content to load
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Take screenshot
    const screenshot = await page.screenshot();
    console.log("Screenshot captured");

    // Process the image with Sharp
    const buffer = await sharp(screenshot).png().toBuffer();

    await sharp(buffer)
      .toColorspace("b-w")
      .removeAlpha()
      .rotate(90)
      .png()
      .toFile(path.join(PUBLIC_DIR, "dash.png"));

    console.log("Final dashboard image created");
  } catch (error) {
    console.error("Screenshot capture failed:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

async function createWeatherImage(weatherData: any, batteryPercentage: number) {
  try {
    if (!Array.isArray(weatherData) || weatherData.length === 0 || !weatherData[0].observation) {
      throw new Error("Invalid weather data format");
    }
    const weatherData0 = weatherData[0];
    const observation = weatherData0.observation;
    const currentIconSvg = getIconSvg(observation.iconCode, 100);
    const currentTemp = observation.temperature.metric;
    const currentCondition = observation.condition;

    // Format current time
    const currentTime = formatDateTime();

    // Format wind data
    const windSpeed = observation.windSpeed.metric;
    const windString = windSpeed > 0 ? `${windSpeed} km/h` : "Calm";

    // Simplify alert: show only the banner text if available
    let alertHtml = "";
    if (
      weatherData0.alert &&
      Array.isArray(weatherData0.alert.alerts) &&
      weatherData0.alert.alerts.length > 0
    ) {
      alertHtml = `<div class="alert"><strong>${weatherData0.alert.alerts[0].alertBannerText || "Alert"}</strong></div>`;
    } else {
      alertHtml = "";
    }

    const aqhi = weatherData0.aqhi;

    // Hourly forecast reformatted into a list
    let hourlyHtml = "";
    if (weatherData0.hourlyFcst && weatherData0.hourlyFcst.hourly) {
      // Add the current hour to the hourly forecast
      const hourlyCount = alertHtml === "" ? 10 : 9;
      const next6Hours = weatherData0.hourlyFcst.hourly.slice(0, hourlyCount);
      hourlyHtml = next6Hours
        .map((hour: any) => {
          const iconSvg = getIconSvg(hour.iconCode, 48);
          const conditionLength = hour.condition.length;
          const conditionClass =
            conditionLength >= 20
              ? "hourly-condition long-text"
              : conditionLength >= 15
                ? "hourly-condition medium-text"
                : "hourly-condition";
          return `<div class="hourly-item">
                          <div class="hourly-time">${hour.time}</div>
                          <div class="hourly-icon">${iconSvg}</div>
                          <div class="hourly-temp"><span class="temp-value">${hour.temperature.metric}</span>°C</div>
                          <div class="${conditionClass}">${hour.condition}</div>
                        </div>`;
        })
        .join("");
    }

    // Daily forecast optimized to show one row per day with day/night split
    let dailyHtml = "";
    if (weatherData0.dailyFcst && weatherData0.dailyFcst.daily) {
      const dailyForecasts = weatherData0.dailyFcst.daily;

      // Group forecasts by date and separate day/night
      const groupedForecasts = dailyForecasts.reduce((acc: any, forecast: any) => {
        const date = forecast.date;
        if (!acc[date]) {
          acc[date] = {
            date,
            label: forecast.periodLabel,
            day: null,
            night: null,
          };
        }

        // Check if it's a night forecast by looking for "Night" in the label
        if (
          (forecast.periodLabel && forecast.periodLabel.includes("Night")) ||
          forecast.periodLabel.includes("Nuit")
        ) {
          acc[date].night = forecast;
        } else {
          acc[date].day = forecast;
        }

        return acc;
      }, {});

      dailyHtml = Object.values(groupedForecasts)
        .map((forecast: any) => {
          // Extract just the day from the date label (e.g., "Wed, 19" from "Wed, 19 Feb")
          const dateLabel = (forecast.label || forecast.date).split(" ").slice(0, 2).join(" ");
          let rowHtml = '<div class="daily-item">';
          rowHtml += `<div class="daily-header">${dateLabel}</div>`;

          // Create a day column (even if empty for night-only forecasts)
          rowHtml += '<div class="temp-group">';
          if (forecast.day) {
            const dayIcon = getIconSvg(forecast.day.iconCode, 48);
            const summaryLength = forecast.day.summary.length;
            const conditionClass =
              summaryLength > 20 ? "daily-condition long-text" : "daily-condition";
            rowHtml += `
                            <div class="temp-block">
                                <div class="temp-row">
                                    <div class="daily-icon">${dayIcon}</div>
                                    <div class="daily-temp"><span class="temp-value">${forecast.day.temperature.metric}</span>°C</div>
                                </div>
                                <div class="${conditionClass}">${forecast.day.summary}</div>
                            </div>`;
          }
          rowHtml += "</div>";

          // Create a night column
          rowHtml += '<div class="temp-group">';
          if (forecast.night) {
            const nightIcon = getIconSvg(forecast.night.iconCode, 48);
            const summaryLength = forecast.night.summary.length;
            const conditionClass =
              summaryLength > 18
                ? "daily-condition extra-long-text"
                : summaryLength > 9
                  ? "daily-condition long-text"
                  : "daily-condition";
            rowHtml += `
                            <div class="temp-block">
                                <div class="temp-row">
                                    <div class="daily-icon">${nightIcon}</div>
                                    <div class="daily-temp"><span class="temp-value">${forecast.night.temperature.metric}</span>°C</div>
                                </div>
                                <div class="${conditionClass}">${forecast.night.summary}</div>
                            </div>`;
          }
          rowHtml += "</div>";

          rowHtml += "</div>";
          return rowHtml;
        })
        .join("");
    }

    // Build the HTML with fixed dimensions optimized for Kindle
    const htmlString = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --dashboard-width: 1448px;
      --dashboard-height: 1072px;
      --aspect-ratio: calc(1072 / 1448);

      /* Color variables */
      --text-primary: #000000;    /* For the most important information */
      --text-secondary:rgb(75, 75, 75);  /* For supporting information */
      --text-muted: #666666;     /* For less important details */

      /* Add new spacing variable */
      --temp-negative-spacing: 0.07em;
    }

    body {
      font-family: 'Comic Neue', cursive;
      margin: 0;
      background-color: #f0f0f0;
      width: 100vw;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }

    .container {
      width: var(--dashboard-width);
      height: var(--dashboard-height);
      aspect-ratio: calc(1448 / 1072);
      display: flex;
      background: #fff;
      max-width: 100vw;
      max-height: 100vh;
      overflow: hidden;
    }

    .column {
      flex: 1;
      padding: 20px;
      background: #fff;
      box-sizing: border-box;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    #left-column {
      border-right: 3px solid #ccc;
    }

    .section {
      margin-bottom: 12px;
      flex-shrink: 0;
    }

    .alert {
      border: 1px solid red;
      padding: 8px;
      background: #ffe6e6;
      margin-bottom: 8px;
      font-size: min(39px, 2.9vw);
      font-weight: bold;
    }

    .hourly-item, .daily-item {
      display: flex;
      align-items: center;
      margin-bottom: 16px;
      gap: 8px;
    }

    .hourly-time, .daily-date {
      flex: 1;
      font-size: min(45px, 3.2vw);
      font-weight: bold;
    }

    .hourly-icon, .daily-icon {
      flex: 0.5;
    }

    .hourly-temp, .daily-temp {
      flex: 0.8;
      font-size: min(45px, 3.2vw);
      font-weight: bold;
    }

    .hourly-condition {
      flex: 2.5;
      font-size: min(45px, 3.2vw);
      font-weight: bold;
      color: var(--text-secondary);
      text-align: center;
    }

    .hourly-condition.medium-text {
      font-size: min(39px, 2.9vw);
    }

    .hourly-condition.long-text {
      font-size: min(33px, 2.4vw);
    }

    h2 {
      font-size: min(51px, 3.4vw);
      margin: 8px 0;
      font-weight: bold;
    }

    .icon {
      display: inline-block;
      margin-right: 8px;
    }

    .current-temp {
      font-size: min(101px, 7.2vw);
      font-weight: bold;
      color: var(--text-primary);
    }

    .current-condition, .aqhi-status {
      font-size: min(51px, 3.4vw);
      font-weight: bold;
      margin: 4px 0;
      color: var(--text-secondary);
    }

    .daily-forecast-group {
        margin-bottom: 24px;
    }

    .daily-item {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        margin-top: 14px;
        margin-bottom: 14px;
        padding-left: 20px;
    }

    .daily-header {
        font-size: min(51px, 3.4vw);
        font-weight: 900;
        min-width: 180px;
        width: 180px;
        padding-top: 8px;
        text-align: left;
        color: var(--text-primary);
    }

    .temp-group {
        flex: 1;
        min-width: 240px;
        text-align: left;
    }

    .temp-row {
        display: flex;
        justify-content: flex-start;
        gap: 8px;
        width: 160px;
    }

    .daily-icon {
      display: flex;
      justify-content: left;
      align-items: left;
      width: 48px;
    }

    .daily-temp {
      font-size: min(51px, 3.4vw);
      font-weight: 900;
      white-space: nowrap;
      width: 100px;
      text-align: left;
      color: var(--text-primary);
    }

    .daily-condition {
        font-size: min(45px, 3.2vw);
        font-weight: 900;
        white-space: normal;
        max-width: 280px;
        line-height: 1.3;
        text-align: left;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        color: var(--text-secondary);
    }

    .daily-condition.long-text {
        font-size: min(39px, 2.9vw);
    }

    .daily-condition.extra-long-text {
        font-size: min(33px, 2.4vw);
    }

    .header-status {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: min(51px, 3.4vw);
      font-weight: bold;
      margin-bottom: 12px;
      gap: 16px;
    }

    .date-battery {
      font-size: min(45px, 3.2vw);
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .current-weather {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .temp-group {
      display: flex;
      align-items: center;
    }

    .current-time {
      font-size: min(57px, 3.4vw);
      font-weight: bold;
      color: var(--text-primary);
    }

    .last-update {
      font-size: min(38px, 2.2vw);
    }

    @media (max-aspect-ratio: 1448/1072) {
      .container {
        width: 100vw;
        height: calc(100vw * var(--aspect-ratio));
      }
    }

    @media (min-aspect-ratio: 1448/1072) {
      .container {
        height: 100vh;
        width: calc(100vh / var(--aspect-ratio));
      }
    }

    #right-column {
        font-weight: 900;
    }

    .hourly-time {
        color: var(--text-primary);
    }

    .hourly-temp {
        color: var(--text-primary);
    }

    .current-condition {
        font-size: min(51px, 3.4vw);
        font-weight: bold;
        margin: 4px 0;
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
    }

    .current-condition > span {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
        justify-content: flex-start;
    }

    .current-condition.medium-text {
        font-size: min(45px, 3vw);
    }

    .current-condition.long-text {
        font-size: min(30px, 2.6vw);
    }

    .weather-details {
        font-size: min(51px, 3.4vw);
        font-weight: bold;
        margin: 4px 0;
        color: var(--text-secondary);
        display: flex;
        justify-content: flex-start;
        width: 100%;
        gap: 48px;
        white-space: nowrap;
    }

    .weather-details > span {
        display: flex;
        align-items: center;
        gap: 16px;
        justify-content: flex-start;
        min-width: 180px;
    }

    /* Add this new class */
    .temp-value {
        letter-spacing: var(--temp-negative-spacing);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="column" id="left-column">
      <div class="section">
        <div class="header-status">
          <span class="${
            currentCondition.length >= 20
              ? "current-condition long-text"
              : currentCondition.length >= 15
                ? "current-condition medium-text"
                : "current-condition"
          }">${currentCondition}</span>
          <span class="date-battery">${getBatteryIcon(batteryPercentage)} ${batteryPercentage}% | ${currentTime.split("|")[0]}</span>
        </div>
        <div class="current-weather">
          <div class="temp-group">
            <span class="icon">${currentIconSvg}</span>
            <span class="current-temp"><span class="temp-value">${currentTemp}</span>°C</span>
          </div>
          <span class="current-time"><span class="last-update">${LANGUAGE === "fr" ? "Mis à jour à " : "Updated at"}: </span>${currentTime.split("|")[1].trim()}</span>
        </div>
        <div class="current-condition">
            <div class="weather-details">
                <span>${getIconSvg("40", 48)} <span class="temp-value">${observation.feelsLike?.metric || currentTemp}</span>°C</span>
                <span>${getIconSvg("43", 48)} ${windString}</span>
                <span>${getIconSvg("42", 48)} ${observation.humidity}%</span>
            </div>
        </div>
        <div class="aqhi-status">${LANGUAGE === "fr" ? "Cote air santé " : "AQHI"}: ${aqhi.value} (${aqhi.riskText})</div>
      </div>
      <div class="section">
        ${alertHtml}
      </div>
      <div class="section">
        ${hourlyHtml}
      </div>
    </div>
    <div class="column" id="right-column">
      <div class="section">
        ${dailyHtml}
      </div>
    </div>
  </div>
</body>
</html>`;

    fs.writeFileSync(path.join(process.cwd(), "public", "dashapi.html"), htmlString);
    console.log("Dashboard HTML created successfully");
  } catch (error) {
    console.error("Error creating dashboard HTML:", error);
    throw error;
  }
}
