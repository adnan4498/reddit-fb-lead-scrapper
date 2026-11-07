# Debug: JobDataLake raw payload inspection

## Problem
The JobDataLake API returns objects with only these top-level keys:
`['title', 'posted_at', 'first_seen_at', 'locations', 'countries', 'remote_type', 'job_function', 'seniority', 'employment_type']`

Critical fields (`company`, `url`, `id`) are missing, causing the orchestrator to reject all jobs as invalid. The missing data may be nested inside a sub-object not visible from key enumeration alone, or the API may require additional query parameters to return full job details.

## Change
Add a temporary `console.log` inside `fetchPage()` in `src/services/scrapers/jobDataLakeModule.js` to dump the **first** raw job object from `response.data.jobs` as formatted JSON.

### Implementation steps

1. Open `src/services/scrapers/jobDataLakeModule.js`
2. In `fetchPage()`, after extracting `jobs` from `response.data` (line 281), add:

```js
if (jobs.length > 0 && !global.jdlSampleLogged) {
  console.log('[RAW SAMPLE]', JSON.stringify(jobs[0], null, 2));
  global.jdlSampleLogged = true;
}
```

3. Run the scraper once (`node src/services/scrapers/aggregatorApi.js` or equivalent entry point) to capture the output
4. Inspect the `[RAW SAMPLE]` output to identify:
   - Whether `company`, `url`, `id` exist in nested sub-objects (e.g., `company.name`, `job.url`)
   - Whether the API needs different query parameters (`expand`, `include`, `full=true`) to return complete records
5. Remove the debug snippet after inspection

### Affected file
- `src/services/scrapers/jobDataLakeModule.js` — `fetchPage()` function only

### Risk
None. Read-only debug log, gated by `global.jdlSampleLogged` to fire exactly once.
