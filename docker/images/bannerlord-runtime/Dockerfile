# Bannerlord Coop dedicated server runtime
# Game binaries are NOT baked in — mount shared installation read-only.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    WINEPREFIX=/wineprefix \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    DISPLAY=

RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      wine \
      wine64 \
      wine32 \
      winbind \
      cabextract \
      xvfb \
      procps \
      tini \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /opt/bannerlord /srv/instance /wineprefix

VOLUME ["/wineprefix", "/srv/instance"]

WORKDIR /opt/bannerlord

EXPOSE 4200/udp 7210/udp

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
