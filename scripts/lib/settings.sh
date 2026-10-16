# Sourced by the scripts that act on the deployment (PLAN R205). Their settings describe the operator's
# infrastructure, which stays out of this public repository: they come from the environment or from the gitignored
# .env at the repository root (.env.example lists them; none is a secret).

# A linked git worktree has no .env of its own: it reads the main checkout's, so that a push from one still checks the
# private terms (PLAN R209).
SETTINGS_ENV="$ROOT/.env"
if [ ! -f "$SETTINGS_ENV" ] && common=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
then
  SETTINGS_ENV="$(dirname "$common")/.env"
fi

# setting NAME [default]: NAME from the environment, else from .env (its last line for NAME, without the quotes around
# the value), else the default.
setting() {
  local value=${!1:-}
  if [ -z "$value" ] && [ -f "$SETTINGS_ENV" ]; then
    value=$(sed -n "s/^$1=//p" "$SETTINGS_ENV" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
  fi
  echo "${value:-${2:-}}"
}

# required NAME: like setting, but stops the script when NAME is set nowhere.
required() {
  local value
  value=$(setting "$1")
  if [ -z "$value" ]; then
    echo "$1 is not set: add it to .env (see .env.example) or to the environment" >&2
    exit 1
  fi
  echo "$value"
}
