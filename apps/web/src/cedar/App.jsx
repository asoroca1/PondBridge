// src/App.jsx
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import GlobalAuthGate from "./GlobalAuthGate";

import Home from "./pages/Home";
import Login from "./pages/Login";
import CreateProfileWizard from "./pages/CreateProfileWizard";

import MainHome from "./pages/MainHome";
import MyProfile from "./pages/MyProfile";
import EditProfile from "./pages/EditProfile";
import AdvancedSearch from "./pages/AdvancedSearch";
import PhotoStream from "./pages/PhotoStream";
import ChatAndForums from "./pages/ChatAndForums.jsx";
import CedarChest from "./pages/CedarChest";
import LocationMap from "./pages/LocationMap";
import SearchResults from "./pages/SearchResults";
import PublicProfile from "./pages/PublicProfile";
import Legal from "./pages/Legal";
import FamilyTrees from "./pages/FamilyTrees";
import FamilyTreeCreate from "./pages/FamilyTreeCreate";
import FamilyTreeView from "./pages/FamilyTreeView";

export default function App() {
  const location = useLocation();
  const routeKey = `${location.pathname}${location.search}${location.hash}`;

  return (
    <div className="app-route-shell">
      <div className="app-route-progress" key={routeKey} aria-hidden="true" />

      <div
        key={routeKey}
        className="app-route-stage"
      >
        <Routes location={location}>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/create-account" element={<CreateProfileWizard />} />
          <Route path="/legal" element={<Legal />} />

          {/* Private */}
          <Route element={<GlobalAuthGate />}>
            <Route path="/main-home" element={<MainHome />} />
            <Route path="/my-profile" element={<MyProfile />} />
            <Route path="/edit-profile" element={<EditProfile />} />
            <Route path="/advanced-search" element={<AdvancedSearch />} />
            <Route path="/photo-stream" element={<PhotoStream />} />
            <Route path="/chat-rooms" element={<ChatAndForums />} />
            <Route path="/chat/:id" element={<ChatAndForums />} />
            <Route path="/cedar-chest" element={<CedarChest />} />
            <Route path="/location-map" element={<LocationMap />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/profile/:id" element={<PublicProfile />} />
            <Route path="/family-trees" element={<FamilyTrees />} />
            <Route path="/family-trees/new" element={<FamilyTreeCreate />} />
            <Route path="/family-trees/:id" element={<FamilyTreeView />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
