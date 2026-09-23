import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Header, NotFound } from "./components/States.jsx";
import Listings from "./pages/Listings.jsx";
import Camper from "./pages/Camper.jsx";
import Requested from "./pages/Requested.jsx";
import Paid from "./pages/Paid.jsx";
import Pay from "./pages/Pay.jsx";
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
        {/* b0.9 — where Stripe returns the guest. ?cancelled=1 on the same
            route for an abandoned checkout; see Paid.jsx. */}
        <Route path="/paid/:reservationNum" element={<Paid />} />
        {/* b0.12 — choose how to pay, from the approval text. The token is
            signed by the CRM and is the page's only credential; see Pay.jsx. */}
        <Route path="/pay/:token" element={<Pay />} />
        <Route path="*" element={<NotFound what="page" />} />
      </Routes>
    </BrowserRouter>
  );
}
