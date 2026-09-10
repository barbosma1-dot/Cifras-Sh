import { motion } from 'motion/react';

interface SplashScreenProps {
  label?: string;
}

export default function SplashScreen({
  label
}: SplashScreenProps) {

  return (

    <div className="flex flex-col items-center justify-center min-h-screen bg-brand-blue gap-6 px-6">

      {/* LOGO PRINCIPAL */}
      <motion.div
        initial={{
          opacity: 0,
          y: 8
        }}
        animate={{
          opacity: 1,
          y: 0
        }}
        transition={{
          duration: 0.35
        }}
        className="relative flex items-center justify-center w-full max-w-sm"
      >

        <motion.img
          src="/brand/logo-vertical.png"
          alt="Cifras Shalom"
          className="w-full max-w-[360px] h-auto object-contain drop-shadow-2xl"
          animate={{
            filter: [
              'brightness(1) drop-shadow(0 0 0 rgba(255,255,255,0))',

              'brightness(1.18) drop-shadow(0 0 16px rgba(255,255,255,0.25))',

              'brightness(1) drop-shadow(0 0 0 rgba(255,255,255,0))'
            ]
          }}
          transition={{
            duration: 2.8,
            times: [0, 0.55, 1],
            ease: 'easeInOut',
            repeat: Infinity,
            repeatDelay: 1.8,
            delay: 0.8
          }}
        />

      </motion.div>

      {/* LOADING BAR */}
      <div className="w-48 h-1.5 rounded-full bg-white/20 overflow-hidden">

        <motion.div
          className="h-full w-1/3 rounded-full bg-white"
          animate={{
            x: [
              '-100%',
              '250%'
            ]
          }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />

      </div>

      {/* LABEL */}
      {label && (
        <span className="text-white/80 text-sm font-medium tracking-wide">
          {label}
        </span>
      )}

    </div>
  );
}
