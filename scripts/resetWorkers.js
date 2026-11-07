const http = require("http");

const API_URL = process.env.API_URL || "http://localhost:3000";
const RESET_PATH = "/api/workers/reset";

function postReset() {
  return new Promise((resolve, reject) => {
    const url = new URL(RESET_PATH, API_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": "0" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

postReset()
  .then((result) => {
    if (result.status === 200) {
      console.log("Reset complete:", JSON.stringify(result.body, null, 2));
    } else {
      console.error("Reset failed (HTTP " + result.status + "):", result.body);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Reset request failed:", err.message);
    process.exit(1);
  });
