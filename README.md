# ts-type-diagnostic

## Translate typescript type assignment errors into a conflict table.

### Instead of something like this:

![before](./images/before.png)

### Something like this:

![after](./images/after.png)

# Installation

```shell
# Globally.
npm install -g ts-type-diagnostic
```

# Usage

## Command Line

```shell
# Create a table for a ts file with a conflict error.
tstd file.ts

# Create a verbose table.
tstd --v file.ts
```
