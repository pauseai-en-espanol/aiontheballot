# Changesets

Every change that affects a package's behaviour needs a changeset: run `pnpm release:note` and describe the change.
Changes with no release impact (docs, CI) can use `pnpm release:empty`. Image tags are derived from package
versions, so releases flow from these notes. See the [changesets docs](https://github.com/changesets/changesets).
