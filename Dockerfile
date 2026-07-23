FROM node:22-bookworm-slim AS imagemagick

ARG IMAGEMAGICK_VERSION=7.1.0-23
WORKDIR /tmp/imagemagick-build

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl build-essential pkg-config autoconf automake libtool \
    libltdl-dev libjpeg62-turbo-dev libpng-dev libtiff-dev libwebp-dev libheif-dev libopenjp2-7-dev libxml2-dev zlib1g-dev \
  && curl -fsSL "https://github.com/ImageMagick/ImageMagick/archive/refs/tags/${IMAGEMAGICK_VERSION}.tar.gz" -o imagemagick.tar.gz \
  && tar -xzf imagemagick.tar.gz --strip-components=1 \
  && ./configure \
    --prefix=/usr/local \
    --with-quantum-depth=16 \
    --enable-hdri \
    --disable-static \
    --with-modules \
    --without-perl \
  && make -j"$(nproc)" \
  && make install \
  && ldconfig /usr/local/lib \
  && magick -version \
  && rm -rf /tmp/imagemagick-build /var/lib/apt/lists/*

FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates libltdl7 libjpeg62-turbo libpng16-16 libtiff6 libwebp7 libheif1 libopenjp2-7 libxml2 zlib1g libgomp1 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=imagemagick /usr/local /usr/local
RUN ldconfig /usr/local/lib && magick -version

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json app.ts ./
COPY src ./src
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY models ./models

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/app.js"]
