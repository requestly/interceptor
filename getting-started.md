# Getting Started

This repository contains most of the modules that make up Requestly.

- UI application
- Browser extension
- Common code shared between this project and other projects like Desktop app and Web proxy.

### Install

Please make sure that Node version >= 18.18.0 is installed on your system.

#### Windows Users

If you're using Windows and encounter issues while cloning this repository (due to long file paths), run this command first:

```sh
git config --system core.longpaths true
```

Then proceed with the installation:

```sh
sh install.sh local
```    

This also installs the git pre-commit hook (Husky): the app depends on the root package (`file:..`), and installing the app runs its `prepare: husky install`. The root `.npmrc` sets `ignore-scripts=true`, so a plain `npm install` at the root alone does not install it. If you install without the script, run `npx husky install` once.

### Build

```sh
sh build.sh    
```

### Test

```sh 
sh test.sh
```

## Develop individual modules

### UI application:

👉 Follow [README](./app/README.md).

### Browser extension:

👉 Follow [README](./browser-extension/README.md).

### Rule processor:

👉 Follow [README](./common/rule-processor/README.md).
