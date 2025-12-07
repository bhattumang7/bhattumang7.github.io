FROM jekyll/jekyll:4

# Set working directory
WORKDIR /srv/jekyll

# Copy Gemfile first for better caching
COPY Gemfile Gemfile.lock* ./

# Install dependencies (baked into the image)
RUN bundle install

# Default command
CMD ["bundle", "exec", "jekyll", "serve", "--livereload", "--force_polling", "--host", "0.0.0.0"]
