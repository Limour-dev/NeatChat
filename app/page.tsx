"use client";

import { useEffect } from "react";
import { useChatStore } from "./store/chat";

import { Home } from "./components/home";

export default function App() {
  useEffect(() => {
    useChatStore.getState().initMcp();
  }, []);

  return (
    <>
      <Home />
    </>
  );
}
