import { useContext } from "react";
import { ToastContext } from "./ToastContext";

function useToast() {
  return useContext(ToastContext);
}

export { useToast };
