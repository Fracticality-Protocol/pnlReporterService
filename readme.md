# PNL Reporter Service

This service is responsible for reporting the PNL of the vault to the contract. It does this by:

1. Fetching the NAV of the vault from the API
2. Calculating the percentage change and delta since the last report (or in the case of a fresh deployment, since service initialization)
3. Writing the delta to the contract if:

- the nav has changed by more than the percentage change threshold
- the time period threshold has been reached

Note: no writing to the contract will happen if the nav hasn't changed at all.

# Running the service

- Fill out all the environment variables in the .env file.
- run tests

```shell
npm run test
```

- npm run dev to run locally

```shell
npm run dev
```

- npm run build to build the service

```shell
npm run build
```

- npm run start to run the built service

```shell
npm run start
```
