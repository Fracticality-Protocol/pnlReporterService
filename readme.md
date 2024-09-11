# PNL Reporter Service

This service is responsible for reporting the fund's PNL to the contract. It does this by:

1. Fetching the NAV of the vault from the API
2. Comparing the newest NAV to the vault's vaultAssets() value, which is in way a snapshot of a previous NAV.
3. Writing the delta to the contract if:

- The nav has changed by more than the percentage change threshold
- The time period threshold has been reached

Note: no writing to the contract will happen if the nav hasn't changed at all.

# Warning

The NAV value that is reported to this service MUST include ALL changes to it coming from deposits and withdrawals since last time the service was run.

In other words, in the period between the last time the service was run, all deposits and withdrawals that occurred in the contract must be reflected in the NAV value that is reported to this service.

If this is not done, wrong profits or losses will be reported to the contract.

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
