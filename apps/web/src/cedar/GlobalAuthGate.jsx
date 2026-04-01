import { Navigate, Outlet, useLocation, matchPath } from "react-router-dom";
import { isAuthed } from "./lib/auth";

// Only these paths are public
const PUBLIC_PATHS = ["/", "/login", "/create-account"];

export default function GlobalAuthGate() {
  const location = useLocation();
  const authed = isAuthed();

  const isPublic = PUBLIC_PATHS.some((p) =>
    matchPath({ path: p, end: true }, location.pathname)
  );

  if (!authed && !isPublic) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }
  return <Outlet />; // render matched child route
}
