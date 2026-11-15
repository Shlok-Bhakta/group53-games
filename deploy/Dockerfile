# The kiwi deployer (deploy/README.md): Node for the Convex CLI, git and rsync for the checkout, and the Docker CLI
# with compose and buildx to rebuild the stack through the host's socket. Rebuilt only by hand, never by a deploy.
FROM docker.io/library/docker:29-cli AS docker

FROM docker.io/library/node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git rsync ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
# What this image was built from, so run.mjs can tell when main has a newer deployer than the one running.
COPY Dockerfile loop.sh /deployer/
RUN mkdir -p /work && chown 1000:1000 /work
USER 1000:1000
ENV HOME=/work/home
ENTRYPOINT ["sh", "/deployer/loop.sh"]
