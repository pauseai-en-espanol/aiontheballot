# The migrations image: dbmate plus the migrations, run by the chart's migration Job as the database owner.
# Build context: the repository root. See db/package.json "docker:build".
FROM ghcr.io/amacneil/dbmate:2.38.1@sha256:b0c8a87bfef4f2819fdb0a68ca357a44d12fb90d23eca695fcfc3b7e159cb1c5
COPY db/migrations /db/migrations
USER 65534:65534
ENTRYPOINT ["dbmate", "--no-dump-schema", "--migrations-dir", "/db/migrations", "--wait"]
CMD ["up"]
