# Nano-GPT-Model-Ranking.js

A lightweight userscript for ranking AI model providers on `nano-gpt.com` by practical value, not just raw price.

## What it does

- Computes a blended cost using input, output, and cache-read pricing
- Rewards faster throughput as a competence modifier
- Adjusts for model precision (FP16/BF16/FP8/FP4)
- Excludes `Auto` entries from medal rankings
- Collapses the benchmarks section automatically
- Adds a sortable `Worth` column to the provider table

##
current usage focus is lumiverse RP handling

## Install

1. Open the raw userscript file:
   - `NanoGPT Dynamic Model Worth & Value Analyzer.user.js`
2. Copy the contents into your userscript manager (e.g. Tampermonkey or Greasemonkey).
3. Visit `https://nano-gpt.com/` and the script will inject its ranking UI automatically.

## Files

- `NanoGPT Dynamic Model Worth & Value Analyzer.user.js` — main script logic
- `NanoGPT Dynamic Model Worth & Value Analyzer.options.json` — optional script settings
- `sync-github.bat` — helper script for syncing with GitHub

## License

This project is licensed under the GNU General Public License v3.0.
