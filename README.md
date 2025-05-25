# Sorting Items

React app for displaying and sorting a list of numbers (1 - 1,000,000) with support for selection, search, drag & drop, and scrolling.

> [!NOTE]
> This is the frontend\
> [This is a link to the backend](https://github.com/marieslo/sorting_numbers_be)

> [!NOTE]
> My free backend server will spin down with inactivity, which can delay requests by 50 seconds or more

---

## Technologies

- React
- TypeScript
- Vite
- @hello-pangea/dnd (drag and drop)
- Axios (API requests)
- Lodash/throttle — to optimize the scroll event handler by limiting how often it can run, preventing excessive calls and improving performance and smoothness of the UI

---

## To install and run locally

```bash
npm install
npm run dev