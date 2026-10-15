<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";

/**
 * A screenshot of the app that follows the docs theme: the light capture in
 * light mode, the dark one in dark mode. Files live in `public/shots` as
 * `<name>-light.webp` and `<name>-dark.webp`, taken at 2x by `just docs-shots`.
 * A cropped shot, such as a menu, shows at its size in the app instead of
 * stretching to the column. Without `name`, it draws an empty frame with the
 * alt text, for pages whose screenshots are not taken yet.
 */
const props = defineProps<{
  name?: string;
  alt: string;
  caption?: string;
}>();

const src = (theme: "light" | "dark") =>
  withBase(`/shots/${props.name}-${theme}.webp`);

// The width in CSS pixels: half the 2x capture.
const width = ref<number>();
const measure = (event: Event) => {
  width.value = (event.target as HTMLImageElement).naturalWidth / 2;
};
</script>

<template>
  <figure class="shot">
    <div
      class="shot-frame"
      :style="width ? { maxWidth: `${width}px` } : undefined"
    >
      <template v-if="name">
        <img
          class="shot-light"
          :src="src('light')"
          :alt="alt"
          loading="lazy"
          @load="measure"
        />
        <img
          class="shot-dark"
          :src="src('dark')"
          :alt="alt"
          loading="lazy"
          @load="measure"
        />
      </template>
      <div v-else class="shot-placeholder" role="img" :aria-label="alt">
        <span>{{ alt }}</span>
      </div>
    </div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.shot {
  margin: 24px 0;
}

.shot-frame {
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--ajour-radius-lg);
  background: var(--vp-c-bg-alt);
}

.shot-frame img {
  display: block;
  width: 100%;
  height: auto;
}

.shot-dark,
:global(.dark) .shot-light {
  display: none;
}

:global(.dark) .shot-dark {
  display: block;
}

.shot-placeholder {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 10;
  padding: 24px;
  color: var(--vp-c-text-3);
  font-size: 13px;
  text-align: center;
}

figcaption {
  margin-top: 8px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
</style>
