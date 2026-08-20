FROM python:3.14-slim AS builder

ENV PIPENV_IGNORE_VIRTUALENVS=1 \
    PIPENV_VENV_IN_PROJECT=1 \
    LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends pipenv \
    && rm -rf /var/lib/apt/lists/*

COPY Pipfile Pipfile.lock pyproject.toml ./
COPY adsb_notifier ./adsb_notifier

RUN pipenv verify && pipenv sync

FROM python:3.14-slim

ARG APP_VERSION=0.0.0
LABEL org.opencontainers.image.title="adsb-notifier-worker" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    ADSB_NOTIFIER_VERSION="${APP_VERSION}" \
    PATH="/app/.venv/bin:${PATH}"

WORKDIR /app
COPY --from=builder /app /app

USER nobody
ENTRYPOINT ["adsb-notifier"]
