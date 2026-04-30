<p align="center">
  <a href="https://requestly.com/" rel="noreferrer noopener">
    <picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcset="https://github.com/requestly/requestly/blob/master/app/src/assets/img/brand/rq_logo_full.svg?raw=true"
      />
      <source
        media="(prefers-color-scheme: light)"
        srcset="https://github.com/requestly/requestly/blob/master/app/src/assets/img/brand/rq_logo_full_light_mode.svg?raw=true"
      />
      <img
        alt="Requestly Logo"
        src="https://github.com/requestly/requestly/blob/master/app/src/assets/img/brand/rq_logo_full.svg?raw=true"
        width="42%"
      />
    </picture>
  </a>
</p>

<h1 align="center">Requestly HTTP Interceptor</h1>

<p align="center">
  Open-Source HTTP Interceptor & Mocking Tool
</p>

<p align="center">
  <strong>Loved by 300k+ developers</strong> — intercept, modify, mock, and debug HTTP(S) traffic from your browser and desktop apps.
</p>

<p align="center">
  <a href="https://github.com/requestly/requestly/stargazers">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/requestly/requestly-http-interceptor?style=flat-square" />
  </a>

  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/requestly/requestly-http-interceptor?style=flat-square"/>

  <a target="_blank" rel="noopener noreferrer" href="https://chrome.google.com/webstore/detail/redirect-url-modify-heade/mdnleldcmiljblolnjhpnblkcekpdkpa/">
    <img alt="Chrome Web Store Rating" src="https://img.shields.io/chrome-web-store/rating/mdnleldcmiljblolnjhpnblkcekpdkpa?style=flat-square" />
  </a>

  <a target="_blank" rel="noopener noreferrer" href="https://chrome.google.com/webstore/detail/redirect-url-modify-heade/mdnleldcmiljblolnjhpnblkcekpdkpa/">
    <img alt="Chrome Web Store Reviews" src="https://img.shields.io/chrome-web-store/rating-count/mdnleldcmiljblolnjhpnblkcekpdkpa?label=reviews&style=flat-square" />
  </a>

  <a target="_blank" rel="noopener noreferrer" href="https://chrome.google.com/webstore/detail/redirect-url-modify-heade/mdnleldcmiljblolnjhpnblkcekpdkpa/">
    <img alt="Chrome Web Store Users" src="https://img.shields.io/chrome-web-store/users/mdnleldcmiljblolnjhpnblkcekpdkpa?label=downloads&style=flat-square" />
  </a>

  <a target="_blank" rel="noopener noreferrer" href="https://status.requestly.io">
    <img alt="Status Badge" src="https://uptime.betterstack.com/status-badges/v2/monitor/13j20.svg" />
  </a>
</p>

<p align="center">
  <a href="https://chrome.google.com/webstore/detail/redirect-url-modify-heade/mdnleldcmiljblolnjhpnblkcekpdkpa/">Download</a>
  ·
  <a href="https://docs.requestly.com/general/http-interceptor/overview">Documentation</a>
  ·
  <a href="https://github.com/requestly/requestly/issues">Report Bug</a>
  ·
  <a href="https://github.com/requestly/requestly/discussions">Discussions</a>
  ·
  <a href="https://get.requestly.com/join-community">Community</a>
</p>

---

# 🚀 What is Requestly HTTP Interceptor?

Requestly HTTP Interceptor is an open-source HTTP interception and traffic debugging tool that helps developers intercept, inspect, monitor, and modify HTTP(S) traffic directly from browsers and desktop apps.

It supports powerful debugging workflows including request/response modification, API mocking, session recording, traffic inspection, and environment overrides without requiring complex proxy or VPN setup.

Trusted by **300,000+ developers** and **11,000+ companies worldwide**.

---

## ✨ Features

### 🌐 HTTP Interceptor

Intercept, monitor, and modify HTTP(S) requests and responses in real time.

📚 Docs: https://docs.requestly.com/general/http-interceptor/overview

#### Supported capabilities

- Redirect URLs and environments
- Map local files and remote resources
- Modify request and response headers
- Override API request and response bodies
- Inject custom JavaScript into webpages
- Debug and inspect network traffic
- Capture traffic from browsers, mobile apps, and desktop apps

#### Common use cases

- Redirect production traffic to local or staging
- Test feature flags and edge cases
- Override APIs during frontend development
- Replace analytics or third-party scripts
- Simulate backend failures and latency

<p align="center">
  <img
    alt="Requestly HTTP Interceptor"
    src="https://github.com/user-attachments/assets/791e54cb-d817-4bc2-83a6-e8bdd3b1cef7"
  />
</p>

### ⚡ API Mocking

Build and test frontend applications without waiting for backend APIs.

📚 Docs: https://docs.requestly.com/general/api-mocking/api-mocking

#### Features

- Local API mocking
- Cloud-hosted mocks
- Static & dynamic response overrides
- GraphQL request targeting
- Bulk mock generation from recorded sessions
- Mock APIs in Cypress, Playwright, Selenium, and CI pipelines

#### Supported workflows

- Frontend parallel development
- E2E testing
- QA & staging simulations
- Offline development
- Contract testing

<p align="center">
  <img
    alt="Requestly API Mocking"
    src="https://github.com/user-attachments/assets/7bc00c7e-c280-40eb-9a2a-c070ecdea662"
  />
</p>

### 🔄 1-Click Imports

Easily migrate existing configurations from other tools.

#### Supported imports

- Charles Proxy
- ModHeader
- Resource Override

#### 📚 Docs

- https://docs.requestly.com/general/imports/charles-proxy
- https://docs.requestly.com/general/imports/modheader
- https://docs.requestly.com/general/imports/resource-override

<p align="center">
  <img
    alt="Requestly Imports"
    src="https://github.com/user-attachments/assets/6186e916-9036-4847-95dd-53b66a4c2730"
  />
</p>

---

## 🏁 Getting Started

### Install Requestly

#### Browser Extension

Available for:

- Chrome
- Edge
- Firefox

👉 https://chrome.google.com/webstore/detail/redirect-url-modify-heade/mdnleldcmiljblolnjhpnblkcekpdkpa/

#### Desktop App

Use the desktop app to:

- Capture traffic from browsers
- Debug and mock APIs
- Record sessions
- Modify desktop app traffic

👉 https://requestly.com/downloads/

---

## 🧑‍💻 Development

This repository contains the core Requestly platform including:

- Browser Extension
- Web App UI
- Core Traffic Interceptor Logic

### Local Setup

Follow the setup guide:

👉 [Getting Started](./getting-started.md)

### Repositories

- [Browser Extension](./browser-extension)
- [UI Application](./app)
- [Mock Server](https://github.com/requestly/requestly-mock-server)
- [Backend](https://github.com/requestly/requestly-backend)

---

## 🤝 Contributing

We welcome contributions from the community.

Whether you're fixing bugs, improving docs, or building new features, your contributions help make Requestly better for developers everywhere.

### How to contribute

1. Explore open issues
2. Read the contributing guidelines
3. Submit a pull request
4. Join the community discussions

### Useful links

- [Issues](https://github.com/requestly/requestly/issues)
- [Contributing Guide](./CONTRIBUTING.md)
- [Discord Community](https://get.requestly.com/join-community)

---

## 🛟 Support & Resources

- 📚 Documentation: https://docs.requestly.com/general/http-interceptor/overview
- 🔐 Security & Privacy: https://docs.requestly.com/security-privacy/
- 💬 Community: https://get.requestly.com/join-community
- 📧 Email: contact@requestly.com
- ❓ StackOverflow: https://stackoverflow.com/questions/tagged/requestly

---

## ❤️ Built for Developers

Requestly is built to make debugging and testing faster and simpler.

From HTTP interception and API mocking to session replay, Requestly gives developers everything needed to debug and ship confidently.
