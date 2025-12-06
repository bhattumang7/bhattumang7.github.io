# Umang's Blog

Personal blog and portfolio website built with Jekyll.

## How to Run Locally Using Docker

### On Windows (Git Bash / PowerShell)

```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -p 4000:4000 -p 35729:35729 \
  -v "/c/Users/bhatt/OneDrive/Desktop/bhattumang7.github.io:/srv/jekyll" \
  -v "/c/Users/bhatt/OneDrive/Desktop/bhattumang7.github.io/vendor/bundle:/usr/local/bundle" \
  jekyll/jekyll:4 \
  bash -lc "bundle install && bundle exec jekyll serve --livereload --force_polling --host 0.0.0.0"
```

**Note:** Update the paths in the command above to match your actual project location.

### On Mac/Linux

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
