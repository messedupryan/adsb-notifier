FROM python:3.12-slim

ARG APP_VERSION=0.0.0
LABEL org.opencontainers.image.title="adsb-notifier-worker" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ADSB_NOTIFIER_VERSION="${APP_VERSION}"

WORKDIR /app
COPY pyproject.toml ./
COPY adsb_notifier ./adsb_notifier

RUN pip install --no-cache-dir .

USER nobody
ENTRYPOINT ["adsb-notifier"]
