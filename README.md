# Umang's Blog

Personal blog and portfolio website built with Jekyll.

## How to Run Locally Using Docker

### Quick Start (Pre-built Image - Recommended)

This method pre-bakes all 98 gem dependencies into a custom Docker image, reducing startup time from ~2+ minutes to ~27 seconds (just site generation, no network downloads).

**One-liner (builds image if missing, then runs):**

```bash
# Windows (Git Bash)
docker image inspect my-jekyll:latest >/dev/null 2>&1 || docker build -t my-jekyll:latest . && \
MSYS_NO_PATHCONV=1 docker run --rm -p 4000:4000 -p 35729:35729 -v "/c/Users/bhatt/OneDrive/Desktop/bhattumang7.github.io:/srv/jekyll" my-jekyll:latest

# Mac/Linux
docker image inspect my-jekyll:latest >/dev/null 2>&1 || docker build -t my-jekyll:latest . && \
docker run --rm -p 4000:4000 -p 35729:35729 -v "$(pwd):/srv/jekyll" my-jekyll:latest
```

**Or step-by-step:**

```bash
# Step 1: Build image (only needed once, or when Gemfile changes)
docker build -t my-jekyll:latest .

# Step 2: Run the server
# Windows (Git Bash)
MSYS_NO_PATHCONV=1 docker run --rm -p 4000:4000 -p 35729:35729 -v "/c/Users/bhatt/OneDrive/Desktop/bhattumang7.github.io:/srv/jekyll" my-jekyll:latest

# Mac/Linux
docker run --rm -p 4000:4000 -p 35729:35729 -v "$(pwd):/srv/jekyll" my-jekyll:latest
```

The site will be available at `http://localhost:4000`.

**When to rebuild the image:**
- After modifying `Gemfile` or `Gemfile.lock`
- Run: `docker build -t my-jekyll:latest .`

---

### Alternative: Without Pre-built Image

#### On Windows (Git Bash / PowerShell)

```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -p 4000:4000 -p 35729:35729 \
  -v "/c/Users/bhatt/OneDrive/Desktop/bhattumang7.github.io:/srv/jekyll" \
  -v "/c/Users/bhatt/OneDrive/Desktop/bhattumang7.github.io/vendor/bundle:/usr/local/bundle" \
  jekyll/jekyll:4 \
  bash -lc "bundle install && bundle exec jekyll serve --livereload --force_polling --host 0.0.0.0"
```

**Note:** Update the paths in the command above to match your actual project location.

#### On Mac/Linux

```bash
docker run --rm -it \
  -p 4000:4000 -p 35729:35729 \
  -v "$(pwd):/srv/jekyll" \
  -v "$(pwd)/vendor/bundle:/usr/local/bundle" \
  jekyll/jekyll:4 \
  bash -lc "bundle install && bundle exec jekyll serve --livereload --force_polling --host 0.0.0.0"
```

### What this command does:

- Starts a Jekyll development server on `http://localhost:4000`
- Enables livereload on port 35729 for automatic browser refresh
- Installs all necessary dependencies via `bundle install`
- Watches for file changes and rebuilds automatically with `--force_polling`
- Caches gems in the `vendor/bundle` directory for faster restarts

**Important:** After making changes to `_config.yml`, you must restart the container for the changes to take effect. Stop the container with `Ctrl+C` and run the command again.

## Configuration

The site configuration is managed in `_config.yml`. To exclude pages from the navigation menu, add them to the `nav_exclude` list.

## Deployment

This site is hosted on GitHub Pages and automatically deploys when changes are pushed to the master branch.

## Fertilizer Calculator Version

**Current Version: 1.1.4**

Version history is tracked with each release.
