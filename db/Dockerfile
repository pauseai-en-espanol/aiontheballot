# The migrations image: dbmate plus the migrations, run by the chart's migration Job as the database owner.
# Build context: the repository root. See db/package.json "docker:build".
FROM ghcr.io/amacneil/dbmate:2.36.0@sha256:520c740c6e0ad73fde2cd1ea7e2b779aaf789d22aca8858f87a478e7094535fb
COPY db/migrations /db/migrations
USER 65534:65534
ENTRYPOINT ["dbmate", "--no-dump-schema", "--migrations-dir", "/db/migrations", "--wait"]
CMD ["up"]
