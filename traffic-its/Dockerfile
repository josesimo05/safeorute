# syntax=docker/dockerfile:1
FROM python:3.12.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MPLCONFIGDIR=/tmp/matplotlib \
    XDG_CACHE_HOME=/tmp/cache

# Supervision requires opencv-python. These libraries satisfy its native imports;
# no display server, video archive or browser is started in the worker.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 its \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/its its

WORKDIR /app
COPY requirements.lock /app/requirements.lock
# An optional organizational CA bundle can be supplied by the builder. It is
# mounted for this step only and never copied into the runtime image. TLS
# verification remains enabled with or without this secret.
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.pem \
    if [ -f /tmp/build-ca.pem ]; then export PIP_CERT=/tmp/build-ca.pem; fi; \
    python -m pip install --no-cache-dir --require-hashes -r /app/requirements.lock
COPY --chown=its:its src/ /app/src/
COPY --chown=its:its configs/ /app/configs/
COPY --chown=its:its models/ /app/models/
COPY --chown=its:its pyproject.toml /app/pyproject.toml
COPY --chown=its:its THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md
COPY --chown=its:its licenses/ /app/licenses/
RUN mkdir -p /app/data && chown its:its /app/data /home/its
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "traffic_its.cli", "api", "--host", "0.0.0.0", "--port", "8000"]
