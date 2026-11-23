# The migrations image: dbmate plus the migrations, run by the chart's migration Job as the database owner.
# Build context: the repository root. See db/package.json "docker:build".
FROM ghcr.io/amacneil/dbmate:2.38.2@sha256:fb4fe7cabfe98cf864d63ce083867f3c303a8c1a022fcd69081439425706e909
COPY db/migrations /db/migrations
USER 65534:65534
ENTRYPOINT ["dbmate", "--no-dump-schema", "--migrations-dir", "/db/migrations", "--wait"]
CMD ["up"]
