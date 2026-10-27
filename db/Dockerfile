# The migrations image: dbmate plus the migrations, run by the chart's migration Job as the database owner.
# Build context: the repository root. See db/package.json "docker:build".
FROM ghcr.io/amacneil/dbmate:2.37.0@sha256:0101fcc9999596f4a6930e5627296cd91f3bfa225e3e8c1699fc00881e439cc6
COPY db/migrations /db/migrations
USER 65534:65534
ENTRYPOINT ["dbmate", "--no-dump-schema", "--migrations-dir", "/db/migrations", "--wait"]
CMD ["up"]
