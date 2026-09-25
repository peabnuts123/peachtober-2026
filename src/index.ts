import './style.css';

import { DebugModule } from '@lopoly/engine/util/DebugModule';
import { Vector3, Color3, Vector2, Quaternion, clamp, Color4, type Vector3Like } from '@lopoly/engine/math';
import { BoxColliderNode, ColliderNode, ModelNode, PointLightNode, type BoxColliderShapeConstructorArgs } from '@lopoly/engine/scene/nodes';
import { Model } from '@lopoly/engine/models';
import { GamepadAxis, GamepadButton, GltfLoader, KeyCode, Material, ShaderBlendingMode, type IInputSystem } from '@lopoly/engine';
import { CameraNode } from '@lopoly/engine/scene/nodes';
import { Engine } from '@lopoly/engine/Engine';
import { Scene, SceneNode, type IScene } from '@lopoly/engine/scene';
import { WebFileSystem } from '@lopoly/engine/filesystem/WebFileSystem';

const Config = {
  UrlPrefix: `/peachtober-2026`,
};

class Player extends SceneNode {
  // Config
  private static readonly TargetPlayerHeightMeters = 1.75;
  private static readonly ReferenceHitBox = new Vector3(30, 30, 70); // @NOTE Half-life 2 hitbox
  private static readonly Speed: number = 5;
  private static readonly CameraRotateSpeed = 150;
  private static readonly CameraCursorFactor = 0.3;
  private static readonly Gravity = -30;
  private static readonly JumpSpeed = -Player.Gravity / 4;
  private static readonly MovementDecayHalfLifeSeconds = 0.0375;
  private static readonly SpawnPoint = new Vector3(3.3, 3.3, 0);
  private static readonly RespawnDistance = 200;

  // References
  private readonly camera: CameraNode;
  private readonly collider: ColliderNode;

  // State
  private readonly velocity: Vector3 = Vector3.zero();
  private isOnGround: boolean = false;

  public constructor(scene: IScene) {
    super(scene, 'player');

    // Spawn point
    this.position = Player.SpawnPoint;

    /* Lighting */
    const light = new PointLightNode(scene, 'player:debug_light', { color: Color3.white() }, this);
    light.position.z = 1;

    /* Camera */
    this.camera = new CameraNode(scene, 'player:camera', 70, 4 / 3, this);
    this.camera.position.z = Player.TargetPlayerHeightMeters - 0.15; // @ASSUMPTION One's eyes are 15cm below their height

    /* Collision */
    this.collider = new BoxColliderNode(scene, `player:collider`, 0, {
      x: Player.TargetPlayerHeightMeters * (Player.ReferenceHitBox.x / Player.ReferenceHitBox.z),
      y: Player.TargetPlayerHeightMeters * (Player.ReferenceHitBox.y / Player.ReferenceHitBox.z),
      z: Player.TargetPlayerHeightMeters,
    }, this);
    this.collider.position.z = Player.TargetPlayerHeightMeters / 2;
  }

  override onUpdate(dt: number, _time: number): void {
    // Looking
    const camera = Vector2.zero();
    const cameraAxisXInput = this.input.getAxisValue('player:look:x');
    const cameraAxisYInput = this.input.getAxisValue('player:look:y');

    // @NOTE prefer joystick, fallback to cursor movement
    if (cameraAxisXInput !== 0 || cameraAxisYInput !== 0) {
      /* Joystick */
      camera.x = cameraAxisXInput * Player.CameraRotateSpeed * dt;
      camera.y = cameraAxisYInput * Player.CameraRotateSpeed * dt;
    } else {
      /* Pointer */
      camera.x = this.input.getPointer().xDelta * Player.CameraCursorFactor;
      camera.y = -this.input.getPointer().yDelta * Player.CameraCursorFactor;
    }

    this.camera.rotation.euler.z -= camera.x;
    this.camera.rotation.euler.x = clamp(this.camera.rotation.euler.x + camera.y, -89, 89);

    // Movement
    const inputVelocity = new Vector3(
      this.input.getAxisValue('player:move:x'),
      this.input.getAxisValue('player:move:y'),
      0,
    )
      .normalizeSelf()
      .scaleSelf(Player.Speed);
    /* Transform relative to camera */
    Quaternion.fromAxisAngle(Vector3.up(), this.camera.absoluteRotation.z).rotateVectorInPlace(inputVelocity);

    // Velocity decay
    const movementDecay = Math.pow(0.5, dt / Player.MovementDecayHalfLifeSeconds);
    this.velocity.x *= movementDecay;
    this.velocity.y *= movementDecay;
    this.velocity.z += Player.Gravity * dt;

    // Velocity input
    if (inputVelocity.lengthSquared() > 0.001) {
      this.velocity.x = inputVelocity.x;
      this.velocity.y = inputVelocity.y;
    }
    if (this.isOnGround && this.input.isButtonDown('player:jump')) {
      this.velocity.z = Player.JumpSpeed;
    }

    const originalZVelocity = this.velocity.z * dt;
    const { result } = this.collider.computeMove(this.velocity.scale(dt));
    this.velocity.setValue(result).scaleSelf(1 / dt);
    this.position.addSelf(result);
    this.isOnGround = result.z > originalZVelocity || result.z === 0;

    // @NOTE Sanity check
    if (this.position.length() > Player.RespawnDistance) {
      // Player has fallen out of the level or something, respawn them
      console.warn(`Player has fallen out of the level! Respawning.`);
      this.velocity.setValue(Vector3.zero());
      this.position = Player.SpawnPoint;
    }
  }

  public static async create(scene: IScene): Promise<Player> {
    return Promise.resolve(
      new Player(scene),
    );
  }

  private get input(): IInputSystem { return this.scene.engine.inputSystem; }
}

class Collider extends BoxColliderNode {
  public static readonly DebugVisualise: boolean = false;
  private static _DebugVizModel: Promise<Model> | undefined;

  public constructor(scene: IScene, name: string, dimensions: BoxColliderShapeConstructorArgs, boxModel: Model, parent?: SceneNode) {
    super(scene, name, 0, dimensions, parent);

    if (Collider.DebugVisualise) {
      const box = new ModelNode(scene, `${name}:viz`, boxModel, this);
      box.scale.scaleSelf(dimensions);
      this.drawWireframe = true;
    }
  }

  public static async create(scene: IScene, name: string, dimensions: BoxColliderShapeConstructorArgs, parent?: SceneNode): Promise<Collider> {
    const boxModel = await this.getDebugVizModel(scene);

    return new Collider(
      scene,
      name,
      dimensions,
      boxModel,
      parent,
    );
  }

  private static getDebugVizModel(scene: IScene): Promise<Model> {
    if (Collider._DebugVizModel == undefined) {
      Collider._DebugVizModel = (async () => {
        const boxModelDefinition = await GltfLoader.loadModel('models/cube.glb', scene.engine.fileSystem);
        const boxModel = await Model.fromDefinition(scene.engine, boxModelDefinition);
        boxModel.setMaterialOverride('default', new Material({
          diffuseColor: Color4.fuchsia().scaleSelf(0.5).withA(0x00),
          blendingMode: ShaderBlendingMode.Additive(),
          unlit: true,
        }));

        return boxModel;
      })();
    }
    return Collider._DebugVizModel;
  }

}

class Office extends SceneNode {
  public constructor(scene: IScene) {
    super(scene, 'office');
  }

  public static async create(scene: IScene): Promise<Office> {
    const officeModelDefinition = await GltfLoader.loadModel('models/office.glb', scene.engine.fileSystem);
    const officeModel = await Model.fromDefinition(scene.engine, officeModelDefinition);
    const office = new Office(scene);

    const _modelNode = new ModelNode(scene, 'office:model', officeModel, office);

    async function createCollider(dimensions: BoxColliderShapeConstructorArgs, position: Vector3Like): Promise<Collider> {
      const collider = await Collider.create(scene, `office:collider`, dimensions, office);
      collider.position.setValue(position);

      return collider;
    }

    const _colliders = await Promise.all([
      createCollider({ x: 30, y: 24, z: 1 }, { x: 15, y: 12, z: -0.5 }),
    ]);


    return office;
  }
}

class Game {
  public async run(canvas: HTMLCanvasElement): Promise<void> {
    const fileSystem = new WebFileSystem(Config.UrlPrefix);

    /* Engine */
    const engine = new Engine(canvas, fileSystem, { rendering: { fullScreenDither: true } });
    // engine.setFpsLimit(30);
    this.configureInput(engine.inputSystem);
    engine.inputSystem.lockPointer();

    const scene = new Scene(engine);
    scene.lighting.ambientColor = new Color3(30, 30, 30);
    scene.clearColour = Color3.black();

    /* Scene */
    await Office.create(scene);
    await Player.create(scene);

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
      buttons: [
        {
          name: 'player:jump',
          bindings: [
            KeyCode.Space,
            GamepadButton.South,
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

