import './style.css';

import { DebugModule } from '@lopoly/engine/util/DebugModule';
import { Vector3, Color3, Vector2, Quaternion, clamp, type Vector3Like } from '@lopoly/engine/math';
import { BoxColliderNode, ColliderNode, DirectionalLightNode, ModelNode, PointLightNode, type BoxColliderShapeConstructorArgs } from '@lopoly/engine/scene/nodes';
import { Model } from '@lopoly/engine/models';
import { AxisAlignedBoundingBox, GamepadAxis, GamepadButton, GltfLoader, KeyCode, MouseButton, Transform, type IInputSystem, type ModelDefinition, type ModelPartDefinition } from '@lopoly/engine';
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
  private static readonly CrouchFactor: number = 0.5;
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
  private currentSpeed = Player.Speed;
  private readonly velocity: Vector3 = Vector3.zero();
  private isOnGround: boolean = false;

  public constructor(scene: IScene) {
    super(scene, 'player');

    // Spawn point
    this.position = Player.SpawnPoint;

    /* Lighting */
    const light = new PointLightNode(scene, 'player:debug_light', { color: Color3.white() }, this);
    light.intensity = 0.5;
    light.range = 20;
    light.position.z = 1;

    /* Camera */
    this.camera = new CameraNode(scene, 'player:camera', 60, 4 / 3, this);
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
      .scaleSelf(this.currentSpeed);
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

    // Crouch
    if (this.input.wasButtonPressed('player:crouch')) {
      this.camera.position.z = (Player.TargetPlayerHeightMeters * Player.CrouchFactor) - 0.15; // @ASSUMPTION One's eyes are 15cm below their height
      this.collider.scale.z = Player.CrouchFactor;
      this.collider.position.z = (Player.TargetPlayerHeightMeters * Player.CrouchFactor) / 2;
      this.currentSpeed = Player.Speed * Player.CrouchFactor;
    }
    if (this.input.wasButtonReleased('player:crouch')) {
      this.camera.position.z = Player.TargetPlayerHeightMeters - 0.15; // @ASSUMPTION One's eyes are 15cm below their height
      this.collider.scale.z = 1;
      this.collider.position.z = Player.TargetPlayerHeightMeters / 2;
      this.currentSpeed = Player.Speed;
    }

    // Use
    if (this.input.wasButtonPressed('player:use')) {
      console.log(`[DEBUG] Beep`);
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

  public constructor(scene: IScene, name: string, dimensions: BoxColliderShapeConstructorArgs, parent?: SceneNode) {
    super(scene, name, 0, dimensions, parent);

    this.drawWireframe = Collider.DebugVisualise;
  }

  public static async create(scene: IScene, name: string, dimensions: BoxColliderShapeConstructorArgs, parent?: SceneNode): Promise<Collider> {
    return Promise.resolve(
      new Collider(
        scene,
        name,
        dimensions,
        parent,
      ),
    );
  }
}

class Office extends SceneNode {
  public constructor(scene: IScene) {
    super(scene, 'office');
  }

  public static async create(scene: IScene): Promise<Office> {
    const office = new Office(scene);

    const officeModelDefinition = await this.loadOfficeModelDefinition(scene, office);
    const officeModel = await Model.fromDefinition(scene.engine, officeModelDefinition);

    const _modelNode = new ModelNode(scene, 'office:model', officeModel, office);

    const _sun = new DirectionalLightNode(scene, 'sun', { intensity: 0.2 });
    _sun.rotation.x = -90;

    return office;
  }

  private static async loadOfficeModelDefinition(scene: IScene, office: Office): Promise<ModelDefinition> {
    const officeModelDefinition = await GltfLoader.loadModel('models/office.glb', scene.engine.fileSystem);

    /** Convenience function to create a collider in the scene */
    async function createCollider(dimensions: BoxColliderShapeConstructorArgs, position: Vector3Like): Promise<Collider> {
      const collider = await Collider.create(scene, `office:collider`, dimensions, office);
      collider.absolutePosition.setValue(position);

      return collider;
    }

    // Model parts to remove from the model definition
    const toRemove: { part: ModelPartDefinition, collection: ModelPartDefinition[] }[] = [];

    // Walk model part looking for parts named "Collider*"
    // Create a Collider based on the part's extents, then remove it from the model
    async function walkModelParts(part: ModelPartDefinition, parentPart?: ModelPartDefinition, parentTransform?: Transform<ModelPartDefinition>): Promise<void> {
      const partTransform = new Transform(part, parentTransform);
      partTransform.position = part.transform.position;
      partTransform.rotation.q = part.transform.rotation;
      partTransform.scale = part.transform.scale;

      // If part called Collider*, convert to collider
      if (part.name.startsWith('Collider') && part.mesh) {
        // Compute AABB for mesh
        const meshExtents = AxisAlignedBoundingBox.zero();
        for (const primitive of part.mesh.primitives) {
          meshExtents.unionSelf(primitive.extents);
        }
        meshExtents.transformSelf(partTransform.worldMatrix); // @NOTE worldMatrix is already absolute

        await createCollider({
          x: meshExtents.xMax - meshExtents.xMin,
          y: meshExtents.yMax - meshExtents.yMin,
          z: meshExtents.zMax - meshExtents.zMin,
        }, {
          x: (meshExtents.xMax + meshExtents.xMin) / 2,
          y: (meshExtents.yMax + meshExtents.yMin) / 2,
          z: (meshExtents.zMax + meshExtents.zMin) / 2,
        });

        // Remove from model definition
        if (parentPart !== undefined) {
          toRemove.push({
            part,
            collection: parentPart.children,
          });
        } else {
          toRemove.push({
            part,
            collection: officeModelDefinition.rootParts,
          });
        }
      }

      // Walk children
      for (const childPart of part.children) {
        await walkModelParts(childPart, part, partTransform);
      };
    }

    // Walk scene root objects
    for (const rootPart of officeModelDefinition.rootParts) {
      await walkModelParts(rootPart);
    }

    // Remove model parts converted to colliders
    for (const { part, collection } of toRemove) {
      collection.splice(collection.indexOf(part), 1);
    }

    return officeModelDefinition;
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
    scene.lighting.ambientColor = new Color3(1, 1, 1).scaleSelf(100);
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
        {
          name: 'player:crouch',
          bindings: [
            KeyCode.ControlLeft,
            KeyCode.ControlRight,
            GamepadButton.L2,
            GamepadButton.L3,
          ],
        },
        {
          name: 'player:use',
          bindings: [
            KeyCode.KeyF,
            MouseButton.Left,
            GamepadButton.East,
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
