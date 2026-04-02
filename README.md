# GitHub Pages Site

This folder contains the standalone marketing site for cgmm3-govern.

## Local preview

From the repository root:

```bash
python3 -m http.server 8000 -d site
```

Then open `http://127.0.0.1:8000`.

## Deployment

The repository includes a GitHub Actions workflow that publishes this folder to
GitHub Pages.

Requirements:

- enable GitHub Pages for the repository
- allow GitHub Actions to deploy Pages
- merge the workflow onto the default branch

The deployed artifact is the contents of `site/`, so the marketing site stays
separate from the application and research source tree.