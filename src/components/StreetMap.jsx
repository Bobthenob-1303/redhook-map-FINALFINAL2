
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { geoMercator, geoPath } from "d3-geo";

gsap.registerPlugin(ScrollTrigger);

// ------------------------------------
// MAP BOUNDARIES
// ------------------------------------

const bounds = {
  minLon: -74.025,
  maxLon: -73.995,
  minLat: 40.66,
  maxLat: 40.69,
};

// ------------------------------------
// PROPERTY PRICE COLORS
// ------------------------------------

function getPriceColor(price, average) {
  let ratio = price / average;

  if (ratio <= 0.60) return "#F4DB34";
  if (ratio <= 0.80) return "#C59B16";
  if (ratio <= 1.20) return "#ED831C";
  if (ratio <= 1.40) return "#B84A0B";

  return "#D32F2F";
}

// ------------------------------------
// PROPERTY DOT SIZE
// ------------------------------------

function getPriceSize(price, average) {
  let ratio = price / average;

  return Math.max(6, Math.min(20, 12 * ratio));
}

// ------------------------------------
// CALCULATE AVERAGE SALE PRICE
// ------------------------------------

function rankProperties(properties) {
  if (properties.length === 0) return [];

  let total = properties.reduce(
    (sum, property) => sum + property.salePrice,
    0
  );

  let average = total / properties.length;

  console.log("Average sale price:", average);

  return properties.map((property) => {
    let difference =
      ((property.salePrice - average) / average) * 100;

    return {
      ...property,
      averagePrice: average,
      difference,
      color: getPriceColor(property.salePrice, average),
      radius: getPriceSize(property.salePrice, average),
      hasSale: true,
    };
  });
}

// ------------------------------------
// CHECK GEOGRAPHIC COORDINATES
// ------------------------------------

function insideArea(coordinates) {
  if (!Array.isArray(coordinates)) return false;

  if (typeof coordinates[0] === "number") {
    let [lon, lat] = coordinates;

    return (
      lon >= bounds.minLon &&
      lon <= bounds.maxLon &&
      lat >= bounds.minLat &&
      lat <= bounds.maxLat
    );
  }

  return coordinates.some(insideArea);
}

// ------------------------------------
// EXTRACT GEOJSON LINES
// ------------------------------------

function extractLines(data) {
  let lines = [];

  if (!Array.isArray(data.features)) {
    return lines;
  }

  data.features.forEach((feature) => {
    let geometry = feature.geometry;

    if (!geometry?.coordinates) return;

    if (geometry.type === "LineString") {
      if (insideArea(geometry.coordinates)) {
        lines.push(geometry);
      }
    }

    if (geometry.type === "MultiLineString") {
      geometry.coordinates.forEach((coordinates) => {
        if (insideArea(coordinates)) {
          lines.push({
            type: "LineString",
            coordinates,
          });
        }
      });
    }
  });

  return lines;
}

// ------------------------------------
// MAIN COMPONENT
// ------------------------------------

function StreetMap() {
  const sectionRef = useRef(null);

  const [mapData, setMapData] = useState({
    streets: [],
    truckRoutes: [],
    properties: [],
  });

  const [showTruckRoutes, setShowTruckRoutes] =
    useState(false);

  const [error, setError] = useState("");

  // ------------------------------------
  // LOAD MAP DATA
  // ------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function loadJSON(path) {
      let response = await fetch(path);

      if (!response.ok) {
        throw new Error(
          `Failed to load ${path} (${response.status})`
        );
      }

      return response.json();
    }

    async function loadMap() {
      try {
        const baseURL = import.meta.env.BASE_URL;

        // IMPORTANT:
        // This loads your NEW smaller street file.

        const streetURL =
          `${baseURL}data/redhook-streets.geojson`;

        const truckURL =
          `${baseURL}data/nyc-truck-routes.geojson`;

        const propertyURL =
          `${baseURL}data/redhook-priced-properties.json`;

        console.log("Loading map data...");

        const [streetData, truckData, propertyData] =
          await Promise.all([
            loadJSON(streetURL),
            loadJSON(truckURL),
            loadJSON(propertyURL),
          ]);

        if (cancelled) return;

        // ------------------------------------
        // EXTRACT STREETS AND TRUCK ROUTES
        // ------------------------------------

        let streetLines = extractLines(streetData);
        let truckLines = extractLines(truckData);

        console.log("Street lines:", streetLines.length);
        console.log("Truck lines:", truckLines.length);

        if (streetLines.length === 0) {
          throw new Error(
            "No street lines found in redhook-streets.geojson"
          );
        }

        // ------------------------------------
        // CREATE MAP PROJECTION
        // ------------------------------------

        let collection = {
          type: "FeatureCollection",
          features: streetLines.map((geometry) => ({
            type: "Feature",
            geometry,
            properties: {},
          })),
        };

        let projection = geoMercator().fitExtent(
          [
            [40, 40],
            [960, 760],
          ],
          collection
        );

        let pathGenerator = geoPath(projection);

        // ------------------------------------
        // CONVERT STREETS TO SVG PATHS
        // ------------------------------------

        let streetPaths = streetLines
          .map((geometry) => pathGenerator(geometry))
          .filter(Boolean);

        let truckPaths = truckLines
          .map((geometry) => pathGenerator(geometry))
          .filter(Boolean);

        // ------------------------------------
        // VALIDATE PROPERTY DATA
        // ------------------------------------

        if (!Array.isArray(propertyData)) {
          throw new Error(
            "redhook-priced-properties.json must be an array"
          );
        }

        let validProperties = propertyData
          .filter((property) => {
            if (
              property.longitude == null ||
              property.latitude == null
            ) {
              return false;
            }

            let lon = Number(property.longitude);
            let lat = Number(property.latitude);

            return (
              Number.isFinite(lon) &&
              Number.isFinite(lat) &&
              lon >= bounds.minLon &&
              lon <= bounds.maxLon &&
              lat >= bounds.minLat &&
              lat <= bounds.maxLat
            );
          })
          .map((property) => ({
            ...property,
            longitude: Number(property.longitude),
            latitude: Number(property.latitude),

            salePrice:
              property.salePrice == null ||
              property.salePrice === ""
                ? null
                : Number(property.salePrice),
          }));

        // ------------------------------------
        // SEPARATE PRICED AND UNPRICED
        // ------------------------------------

        let priced = validProperties.filter(
          (property) =>
            property.salePrice != null &&
            Number.isFinite(property.salePrice) &&
            property.salePrice > 0
        );

        let unpriced = validProperties.filter(
          (property) =>
            property.salePrice == null ||
            !Number.isFinite(property.salePrice) ||
            property.salePrice <= 0
        );

        // Calculate average-based colors and sizes
        let rankedPriced = rankProperties(priced);

        // Gray dots for properties without sales
        let rankedUnpriced = unpriced.map((property) => ({
          ...property,
          salePrice: null,
          averagePrice: null,
          difference: null,
          color: "#777777",
          radius: 6,
          hasSale: false,
        }));

        // Gray underneath colored dots
        let ranked = [
          ...rankedUnpriced,
          ...rankedPriced,
        ];

        // ------------------------------------
        // CONVERT PROPERTY COORDINATES
        // ------------------------------------

        let propertyPoints = ranked
          .map((property) => {
            let position = projection([
              property.longitude,
              property.latitude,
            ]);

            if (!position) return null;

            let [x, y] = position;

            if (
              !Number.isFinite(x) ||
              !Number.isFinite(y)
            ) {
              return null;
            }

            return {
              ...property,
              x,
              y,
            };
          })
          .filter(Boolean);

        if (cancelled) return;

        // ------------------------------------
        // UPDATE REACT STATE
        // ------------------------------------

        setMapData({
          streets: streetPaths,
          truckRoutes: truckPaths,
          properties: propertyPoints,
        });

        setError("");

        console.log("Streets loaded:", streetPaths.length);
        console.log("Truck routes loaded:", truckPaths.length);
        console.log("Priced properties:", priced.length);
        console.log("Gray properties:", unpriced.length);
        console.log("Total dots:", propertyPoints.length);

      } catch (err) {
        if (!cancelled) {
          console.error("Map loading error:", err);
          setError(err.message);
        }
      }
    }

    loadMap();

    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------
  // SCROLL ANIMATION
  // ------------------------------------

  useLayoutEffect(() => {
    if (mapData.streets.length === 0) return;

    let ctx = gsap.context(() => {
      let paths = gsap.utils.toArray(
        ".street",
        sectionRef.current
      );

      let propertyDots = gsap.utils.toArray(
        ".property-marker",
        sectionRef.current
      );

      let validPaths = [];

      // ------------------------------------
      // INITIALIZE STREET PATHS
      // ------------------------------------

      paths.forEach((path) => {
        let length = path.getTotalLength();

        if (!Number.isFinite(length) || length < 3) {
          gsap.set(path, {
            display: "none",
          });

          return;
        }

        gsap.set(path, {
          fill: "none",
          visibility: "hidden",
          strokeDasharray: `${length} ${length + 10}`,
          strokeDashoffset: length + 2,
        });

        validPaths.push(path);
      });

      // ------------------------------------
      // INITIALIZE PROPERTY DOTS
      // ------------------------------------

      // Use radius instead of CSS scaling
      // so geographic positions never change.

      let dots = propertyDots.map((dot) => {
        let finalRadius = Number(
          dot.getAttribute("r")
        );

        gsap.set(dot, {
          attr: { r: 0 },
          opacity: 0,
        });

        return {
          element: dot,
          radius: finalRadius,
        };
      });

      // ------------------------------------
      // CREATE GSAP SCROLL TIMELINE
      // ------------------------------------

      let timeline = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "+=5000",
          scrub: 1,
          pin: true,
          pinSpacing: true,
          anticipatePin: 1,
        },
      });

      // ------------------------------------
      // PHASE 1: STREET DRAWING
      // ------------------------------------

      validPaths.forEach((path, index) => {
        let start = index * 0.08;

        timeline.set(
          path,
          {
            visibility: "visible",
          },
          start
        );

        timeline.to(
          path,
          {
            strokeDashoffset: 0,
            duration: 1,
            ease: "none",
          },
          start
        );
      });

      // ------------------------------------
      // PHASE 2: PROPERTY DOTS
      // ------------------------------------

      if (dots.length > 0) {
        let propertyStart = timeline.duration();

        dots.forEach((dot, index) => {
          timeline.to(
            dot.element,
            {
              attr: {
                r: dot.radius,
              },
              opacity: 1,
              duration: 0.7,
              ease: "power2.out",
            },
            propertyStart + index * 0.035
          );
        });
      }

      ScrollTrigger.refresh();

    }, sectionRef);

    return () => ctx.revert();

  }, [mapData]);

  // ------------------------------------
  // RENDER
  // ------------------------------------

  return (
    <section
      ref={sectionRef}
      className="map-section"
    >
      {/* RED HOOK TITLE */}
      <div className="map-interface">
        <h1>
          <button
            type="button"
            className={`map-title ${
              showTruckRoutes ? "active" : ""
            }`}
            onClick={() =>
              setShowTruckRoutes((previous) => !previous)
            }
            aria-pressed={showTruckRoutes}
            aria-label="Toggle truck routes"
          >
            RED HOOK
          </button>
        </h1>
      </div>

      {/* DISPLAY LOADING ERRORS */}
      {error && (
        <p
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            color: "#ff5555",
            zIndex: 20,
            fontSize: "14px",
          }}
        >
          Map error: {error}
        </p>
      )}

      {/* SVG MAP */}
      <svg
        viewBox="0 0 1000 800"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* WHITE STREETS */}
        {mapData.streets.map((street, index) => (
          <path
            key={`street-${index}`}
            className="street"
            d={street}
            fill="none"
          />
        ))}

        {/* RED TRUCK ROUTES */}
        <g
          className="truck-layer"
          visibility={
            showTruckRoutes ? "visible" : "hidden"
          }
        >
          {mapData.truckRoutes.map((route, index) => (
            <path
              key={`truck-${index}`}
              className="truck-route"
              d={route}
              fill="none"
            />
          ))}
        </g>

        {/* PROPERTY DOTS */}
        <g className="property-layer">
          {mapData.properties.map((property, index) => (
            <circle
              key={`${property.bbl}-${index}`}
              className="property-marker"
              cx={property.x}
              cy={property.y}
              r={property.radius}
              fill={property.color}
            >
              <title>
                {property.hasSale
                  ? `${property.address || "Property"} — $${property.salePrice.toLocaleString()} (${property.difference.toFixed(1)}% vs. average)`
                  : `${property.address || "Property"} — No recorded sale price`}
              </title>
            </circle>
          ))}
        </g>
      </svg>
    </section>
  );
}

export default StreetMap;
