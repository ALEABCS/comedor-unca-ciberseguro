import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { trpc } from "./trpc";
import App from "./App";
import "./styles.css";

if (import.meta.env.MODE === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js")
      .catch((error: unknown) => console.error("No se pudo registrar el service worker de Comedor UNCA.", error));
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 20_000 },
    mutations: { retry: false }
  }
});
const client = trpc.createClient({
  links: [httpLink({
    url: "/trpc",
    fetch(url, options) {
      return fetch(url, { ...options, credentials: "include" });
    }
  })]
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>
);
