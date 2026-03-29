"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

function ShiningText({
  text,
  className
}: {
  text: string;
  className?: string;
}) {
  return (
    <motion.span
      className={cn(
        "bg-[linear-gradient(110deg,#5a5a5a,35%,#ffffff,50%,#5a5a5a,75%,#5a5a5a)] bg-[length:200%_100%] bg-clip-text text-transparent",
        className
      )}
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: "-200% 0" }}
      transition={{
        repeat: Infinity,
        duration: 4.5,
        ease: "linear"
      }}
    >
      {text}
    </motion.span>
  );
}

export { ShiningText };
