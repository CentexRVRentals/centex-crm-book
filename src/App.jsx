import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Header, NotFound } from "./components/States.jsx";
import Listings from "./pages/Listings.jsx";
import Camper from "./pages/Camper.jsx";
import Requested from "./pages/Requested.jsx";
import "./theme.css";

// REAL URLS FROM THE START. /camper/:unitId rather than component state.
//
// SEO is one of the three reasons this is a separate repo, and it cannot be
// retrofitted: switching to routed URLs later means rewriting every navigation
// in the app. One dependency now against a rewrite later.
export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <Routes>
        <Route path="/" element={<Listings />} />
        <Route path="/camper/:unitId" element={<Camper />} />
        <Route path="/requested/:reservationNum" element={<Requested />} />
        <Route path="*" element={<NotFound what="page" />} />
      </Routes>
    </BrowserRouter>
  );
}
