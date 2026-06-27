"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

function createCloudTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.6)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export default function CloudScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    if (!parent) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xe4f1f9, 0.0008);

    const camera = new THREE.PerspectiveCamera(
      60,
      parent.clientWidth / parent.clientHeight,
      0.1,
      4000
    );
    camera.position.set(0, 80, 400);
    camera.lookAt(0, 150, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(parent.clientWidth, parent.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xa0d4ff, 1.5);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 200, 100);
    scene.add(directionalLight);

    const cloudParticles: THREE.Mesh[] = [];
    const texture = createCloudTexture();

    for (let i = 0; i < 150; i++) {
      const size = 200 + Math.random() * 300;
      const geometry = new THREE.PlaneGeometry(size, size);

      const material = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.5 + Math.random() * 0.5,
      });

      const cloud = new THREE.Mesh(geometry, material);

      cloud.position.set(
        (Math.random() - 0.5) * 3000,
        -200 + Math.random() * 100,
        200 - Math.random() * 3000
      );

      cloud.rotation.z = Math.random() * Math.PI * 2;

      cloudParticles.push(cloud);
      scene.add(cloud);
    }

    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      cloudParticles.forEach((c) => {
        c.rotation.z -= 0.0002;
      });
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!parent) return;
      camera.aspect = parent.clientWidth / parent.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(parent.clientWidth, parent.clientHeight);
    });
    resizeObserver.observe(parent);

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      texture.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((m) => m.dispose());
          } else {
            object.material?.dispose();
          }
        }
      });
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10 pointer-events-none"
    />
  );
}