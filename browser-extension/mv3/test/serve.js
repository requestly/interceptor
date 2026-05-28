const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3099;
const HTML_PATH = path.join(__dirname, "network-recording-test.html");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(fs.readFileSync(HTML_PATH, "utf8"));
});

server.listen(PORT, () => {
  console.log(`Test harness running at http://localhost:${PORT}`);
  console.log("Steps:");
  console.log("  1. Build the extension: cd ../  &&  npm run build");
  console.log("  2. Load unpacked from browser-extension/mv3/dist/ in chrome://extensions");
  console.log("  3. Copy the extension ID from chrome://extensions");
  console.log(`  4. Open http://localhost:${PORT} and paste the extension ID`);
  console.log("  5. Enter a URL and click Start Recording");
});
