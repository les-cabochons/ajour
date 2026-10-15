<script setup lang="ts">
import { withBase } from "vitepress";

/**
 * A list of links to docs pages, drawn as the app draws its lists: bordered
 * rows with no outer frame, an icon, a title and one line of description.
 */
defineProps<{
  items: { icon: IconName; title: string; text: string; link: string }[];
}>();

// Remix icon paths, the icon set the app uses. Add one here to use it.
const icons = {
  timer:
    "M17.6177 5.9681L19.0711 4.51472L20.4853 5.92893L19.0319 7.38231C20.2635 8.92199 21 10.875 21 13C21 17.9706 16.9706 22 12 22C7.02944 22 3 17.9706 3 13C3 8.02944 7.02944 4 12 4C14.125 4 16.078 4.73647 17.6177 5.9681ZM12 20C15.866 20 19 16.866 19 13C19 9.13401 15.866 6 12 6C8.13401 6 5 9.13401 5 13C5 16.866 8.13401 20 12 20ZM11 8H13V14H11V8ZM8 1H16V3H8V1Z",
  backlog:
    "M8.00008 6V9H5.00008V6H8.00008ZM3.00008 4V11H10.0001V4H3.00008ZM13.0001 4H21.0001V6H13.0001V4ZM13.0001 11H21.0001V13H13.0001V11ZM13.0001 18H21.0001V20H13.0001V18ZM10.7072 16.2071L9.29297 14.7929L6.00008 18.0858L4.20718 16.2929L2.79297 17.7071L6.00008 20.9142L10.7072 16.2071Z",
  projects:
    "M12.4142 5H21C21.5523 5 22 5.44772 22 6V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H10.4142L12.4142 5ZM4 5V19H20V7H11.5858L9.58579 5H4ZM11 9H13V17H11V9ZM15 12H17V17H15V12ZM7 14H9V17H7V14Z",
  plug: "M13 18V20H19V22H13C11.8954 22 11 21.1046 11 20V18H8C5.79086 18 4 16.2091 4 14V7C4 6.44772 4.44772 6 5 6H8V2H10V6H14V2H16V6H19C19.5523 6 20 6.44772 20 7V14C20 16.2091 18.2091 18 16 18H13ZM8 16H16C17.1046 16 18 15.1046 18 14V11H6V14C6 15.1046 6.89543 16 8 16ZM18 8H6V9H18V8ZM12 14.5C11.4477 14.5 11 14.0523 11 13.5C11 12.9477 11.4477 12.5 12 12.5C12.5523 12.5 13 12.9477 13 13.5C13 14.0523 12.5523 14.5 12 14.5Z",
  keyboard:
    "M3 17H21V19H3V17ZM3 11H6V14H3V11ZM8 11H11V14H8V11ZM3 5H6V8H3V5ZM13 5H16V8H13V5ZM18 5H21V8H18V5ZM13 11H16V14H13V11ZM18 11H21V14H18V11ZM8 5H11V8H8V5Z",
  pullRequest:
    "M15 5H17C18.1046 5 19 5.89543 19 7V15.1707C20.1652 15.5825 21 16.6938 21 18C21 19.6569 19.6569 21 18 21C16.3431 21 15 19.6569 15 18C15 16.6938 15.8348 15.5825 17 15.1707V7H15V10L10.5 6L15 2V5ZM5 8.82929C3.83481 8.41746 3 7.30622 3 6C3 4.34315 4.34315 3 6 3C7.65685 3 9 4.34315 9 6C9 7.30622 8.16519 8.41746 7 8.82929V15.1707C8.16519 15.5825 9 16.6938 9 18C9 19.6569 7.65685 21 6 21C4.34315 21 3 19.6569 3 18C3 16.6938 3.83481 15.5825 5 15.1707V8.82929ZM6 7C6.55228 7 7 6.55228 7 6C7 5.44772 6.55228 5 6 5C5.44772 5 5 5.44772 5 6C5 6.55228 5.44772 7 6 7ZM6 19C6.55228 19 7 18.5523 7 18C7 17.4477 6.55228 17 6 17C5.44772 17 5 17.4477 5 18C5 18.5523 5.44772 19 6 19ZM18 19C18.5523 19 19 18.5523 19 18C19 17.4477 18.5523 17 18 17C17.4477 17 17 17.4477 17 18C17 18.5523 17.4477 19 18 19Z",
  shield:
    "M12 1L20.2169 2.82598C20.6745 2.92766 21 3.33347 21 3.80217V13.7889C21 15.795 19.9974 17.6684 18.3282 18.7812L12 23L5.6718 18.7812C4.00261 17.6684 3 15.795 3 13.7889V3.80217C3 3.33347 3.32553 2.92766 3.78307 2.82598L12 1ZM12 3.04879L5 4.60434V13.7889C5 15.1263 5.6684 16.3752 6.7812 17.1171L12 20.5963L17.2188 17.1171C18.3316 16.3752 19 15.1263 19 13.7889V4.60434L12 3.04879ZM16.4524 8.22183L17.8666 9.63604L11.5026 16L7.25999 11.7574L8.67421 10.3431L11.5019 13.1709L16.4524 8.22183Z",
  download:
    "M3 19H21V21H3V19ZM13 13.1716L19.0711 7.1005L20.4853 8.51472L12 17L3.51472 8.51472L4.92893 7.1005L11 13.1716V2H13V13.1716Z",
} as const;

type IconName = keyof typeof icons;
</script>

<template>
  <ul class="doc-links">
    <li v-for="item in items" :key="item.link">
      <a :href="withBase(item.link)">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path :d="icons[item.icon]" fill="currentColor" />
        </svg>
        <span class="doc-link-title">{{ item.title }}</span>
        <span class="doc-link-text">{{ item.text }}</span>
      </a>
    </li>
  </ul>
</template>

<style scoped>
.doc-links {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  column-gap: 32px;
  margin: 16px 0 40px;
  padding: 0;
  list-style: none;
}

.doc-links li {
  margin: 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.doc-links a {
  display: grid;
  grid-template-columns: 20px 1fr;
  column-gap: 12px;
  padding: 12px 8px;
  border-radius: var(--ajour-radius-md);
  color: inherit;
  text-decoration: none;
}

/* Rows change instantly, as in the app: no transition. */
.doc-links a:hover {
  background: var(--ajour-hover-bg);
}

.doc-links svg {
  grid-row: span 2;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  color: var(--vp-c-text-2);
}

.doc-link-title {
  font-weight: 500;
  font-size: 14px;
}

.doc-link-text {
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.45;
}
</style>
