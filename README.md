# Global Newsflix Jobs collector

Public vacancy collection only. The website, database, credentials and deployment configuration remain in the private site repository.

## Scope

This is the initial South Africa government and shared reader stage. It does not represent 1,000 employers in each country. The registry reports unknown or unverified country coverage explicitly. Existing readers cover Greenhouse, Lever, Ashby, Workday, SuccessFactors, Oracle, SmartRecruiters and selected official portals. ATS detection is not equivalent to a working reader; unsupported iCIMS, Workable and Taleo boards remain unsupported except where actual JobPosting markup is accessible.

## Run

Node 22 and Python 3.12 are used in Actions. Install requirements.txt, run npm test and python -m unittest discover -s tests -p 'test_*.py'. Set JOBS_DRY_RUN=1 to collect locally without authentication or uploads. Optional JOB_SOURCES is a comma-separated list of registered IDs.

Scheduled runs are every six hours. Uploads remain disabled unless repository variable PUBLISH_RESULTS is explicitly set to true and the site's separately reviewed Jobs-only OIDC trust is configured. No long-lived Cloudflare token or site deployment secret belongs here.

Once explicitly enabled, the site accepts only signed GitHub tokens for this exact main-branch jobs workflow, for the two Jobs ingestion endpoints. Source IDs and employer types are checked against the site's registered list. Other site APIs remain private-repository-only.

Only complete source snapshots may prune disappeared jobs. Partial, capped, blocked and failed reads preserve existing listings. Official PDF circulars are incremental and expiry is based on their published deadlines. Pay is shown only as advertised; ambiguous rows are withheld. No login, challenge bypass, paid API or guessed source data is used.

## Updating

Generated with scripts/export-jobs-collector.mjs in the private site repository using an explicit allowlist. Review the manifest before publishing; never copy the private repository or its Git history.
