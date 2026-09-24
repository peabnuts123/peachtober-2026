import './style.css';

import { DebugModule } from '@lopoly/engine/util/DebugModule';
import { Vector3, Color3, Vector2, Quaternion, clamp } from '@lopoly/engine/math';
import { ModelNode, PointLightNode } from '@lopoly/engine/scene/nodes';
import { Model } from '@lopoly/engine/models';
import { GamepadAxis, GltfLoader, KeyCode, type IInputSystem } from '@lopoly/engine';
import { CameraNode } from '@lopoly/engine/scene/nodes';
import { Engine } from '@lopoly/engine/Engine';
import { Scene, SceneNode, type IScene } from '@lopoly/engine/scene';
import { WebFileSystem } from '@lopoly/engine/filesystem/WebFileSystem';

const Config = {
  UrlPrefix: `/peachtober-2026`,
};

class Player extends SceneNode {
  // Config
  private readonly Speed: number = 5;
  private readonly CameraRotateSpeed = 150;
  private readonly CameraCursorFactor = 0.3;

  // References
  private readonly camera: CameraNode;

  public constructor(scene: IScene, parent?: SceneNode) {
    super(scene, 'player', parent);


    // Spawn point
    this.position.x = 3.3;
    this.position.y = 3.3;

    /* Lighting */
    const light = new PointLightNode(scene, 'light', { color: Color3.white() }, this);
    light.position.z = 1;

    /* Camera */
    this.camera = new CameraNode(scene, 'camera', 70, 4 / 3, this);
    this.camera.position.z = 1.7; // 1.7m tall

  }

  override onUpdate(dt: number, _time: number): void {
    // Looking
    const camera = Vector2.zero();
    const cameraAxisXInput = this.input.getAxisValue('player:look:x');
    const cameraAxisYInput = this.input.getAxisValue('player:look:y');

    // @NOTE prefer joystick, fallback to cursor movement
    if (cameraAxisXInput !== 0 || cameraAxisYInput !== 0) {
      /* Joystick */
      camera.x = cameraAxisXInput * this.CameraRotateSpeed * dt;
      camera.y = cameraAxisYInput * this.CameraRotateSpeed * dt;
    } else {
      /* Pointer */
      camera.x = this.input.getPointer().xDelta * this.CameraCursorFactor;
      camera.y = -this.input.getPointer().yDelta * this.CameraCursorFactor;
    }

    this.camera.rotation.euler.z -= camera.x;
    this.camera.rotation.euler.x = clamp(this.camera.rotation.euler.x + camera.y, -89, 89);

    // Movement
    const movement = new Vector3(
      this.input.getAxisValue('player:move:x'),
      this.input.getAxisValue('player:move:y'),
      0,
    )
      .normalizeSelf()
      .scaleSelf(this.Speed * dt);
    /* Transform relative to camera */
    Quaternion.fromAxisAngle(Vector3.up(), this.camera.absoluteRotation.z).rotateVectorInPlace(movement);

    this.position.addSelf(movement);


  }

  private get input(): IInputSystem { return this.scene.engine.inputSystem; }
}

class Game {
  public async run(canvas: HTMLCanvasElement): Promise<void> {
    const fileSystem = new WebFileSystem(Config.UrlPrefix);

    /* Engine */
    const engine = new Engine(canvas, fileSystem, { rendering: { fullScreenDither: true } });
    this.configureInput(engine.inputSystem);
    engine.inputSystem.lockPointer();

    const scene = new Scene(engine);
    scene.lighting.ambientColor = new Color3(30, 30, 30);
    scene.clearColour = Color3.black();

    /* Models */
    const officeModel = await Model.fromDefinition(engine, await GltfLoader.loadModel('models/office.glb', fileSystem));

    /* Scene */
    const _office = new ModelNode(scene, 'office', officeModel);
    const _player = new Player(scene);

    /* Run */
    engine.run();
  }

  private configureInput(input: IInputSystem): void {
    input.configure({
      axes: [
        {
          name: 'player:move:x',
          bindings: [
            { min: KeyCode.KeyA, max: KeyCode.KeyD },
            GamepadAxis.JoyLeftX,
          ],
        },
        {
          name: 'player:move:y',
          bindings: [
            { min: KeyCode.KeyS, max: KeyCode.KeyW },
            GamepadAxis.JoyLeftY,
          ],
        },
        {
          name: 'player:look:x',
          bindings: [
            { min: KeyCode.ArrowLeft, max: KeyCode.ArrowRight },
            GamepadAxis.JoyRightX,
          ],
        },
        {
          name: 'player:look:y',
          bindings: [
            { min: KeyCode.ArrowDown, max: KeyCode.ArrowUp },
            GamepadAxis.JoyRightY,
          ],
        },
      ],
    });
  }
}

try {
  DebugModule.register();

  const canvas = document.getElementById('game') as HTMLCanvasElement;

  const game = new Game();
  await game.run(canvas);
} catch (e) {
  if (e instanceof Error) {
    console.error(`Global error: ${e}, ${e.stack}`);
  } else {
    console.error(`Global error: ${e}`);
  }
}

