FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml ./
COPY adsb_notifier ./adsb_notifier

RUN pip install --no-cache-dir .

USER nobody
ENTRYPOINT ["adsb-notifier"]

