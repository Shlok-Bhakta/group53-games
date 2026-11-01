# The stonks sidecar: one static binary on an empty image (TLS roots and time zones are built in).
FROM docker.io/library/rust:1-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
# Dependencies first, so code changes don't rebuild them.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release --locked && rm -rf src
COPY src src
COPY tests tests
RUN touch src/main.rs && cargo build --release --locked

FROM scratch
COPY --from=build /src/target/release/stonks /stonks
USER 1000:1000
ENTRYPOINT ["/stonks"]
