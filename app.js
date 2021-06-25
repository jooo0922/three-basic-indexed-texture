'use strict';

import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/build/three.module.js';

import {
  OrbitControls
} from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/examples/jsm/controls/OrbitControls.js';

/**
 * 이 예제에서는 GPU 피킹을 사용하여 각 나라를 클릭해서 이름표를 보여주도록 할거임.
 * 
 * 왜 Raycasting을 사용하여 피킹을 구현하지 않은걸까?
 * 물론 구현하는 것 자체는 가능함. 다만 Raycasting을 사용하려면 여러 개의 geometry를 만들어야 하고,
 * 나라마다 3D mesh로 만들어줘야 광선을 쏴서 어떤 나라의 mesh와 가장 먼저 교차하는지 확인할 수 있음.
 * 그런데 각 나라마다 3D mesh를 만들면 15.5MB 짜리 gltf가 나오는데, 지구본 하나 보려고 15.5MB 짜리를 다운받는 건 좀 과하지.
 * 
 * 그래서 각 나라마다 고유한 색상으로 칠해진 피킹용 텍스처를 피킹용 지구본에 씌워서 생성한 뒤,
 * 이 피킹용 지구본을 피킹용 씬에서 렌더링해주는 방법을 이용할거임. 
 * 이러면 사용자가 클릭한 지점에 1*1 카메라를 이용해서 렌더한 장면을 1*1짜리 렌더타겟에 렌더링해주고,
 * 해당 렌더타겟의 픽셀 데이터 값을 읽어와서, 해당 색상값을 십진수 정수로 변환하여 각 나라에 관한 countryInfo 객체를 구분하는 인덱스로 활용함.
 * 
 * 즉, GPU기반 피킹을 사용하는거임. 차이가 있다면 이 예제에서는 하나의 texture에 지정된 색상으로 구분하기 때문에 mesh를 여러 개 만들 필요가 없음.
 */

function main() {
  // create WebGLRenderer
  const canvas = document.querySelector('#canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas
  });

  // create camera
  const fov = 60;
  const aspect = 2;
  const near = 0.1;
  const far = 10;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.z = 2.5;

  // create OrbitControls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; // 카메라 이동 시 관성(inertia) 효과를 줌.
  controls.enablePan = false; // 카메라 고정 후 수평 회전을 못하게 함. (카메라가 수평회전하면 지구본이 카메라 시야에서 벗어나버림)
  controls.minDistance = 1.2; // 카메라를 얼마나 가까운 거리까지 dolly in 할 수 있는지 결정함.
  controls.maxDistance = 4; // 카메라를 얼마나 멀리까지 dolly out 할 수 있는지 결정함.
  controls.update(); // 카메라 이동 관련 변화, enableDamping값을 지정해줬다면 반드시 업데이트 해줘야 함.

  // 씬을 생성하고 배경색을 파란색으로 지정함.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#246');

  // 피킹용 씬도 따로 만들어 줌
  const pickingScene = new THREE.Scene();
  pickingScene.background = new THREE.Color(0); // 피킹용 씬의 배경색은 0x000000. Color 객체에 십진수 정수값을 전달하면, 자동으로 16진수 Hexcode값으로 변환해서 할당함.

  // 전달받은 컬러로 Color 객체를 만든 뒤, 해당 Color 객체의 r, g, b값을 배열로 변환하고, palette 형식화 배열에 지정할 수 있도록 리턴해주는 함수
  const tempColor = new THREE.Color(); // 전달받은 컬러를 set하여 Color 객체로 만들어 줄거임.
  function get255BasedColor(color) {
    tempColor.set(color); // Color.set(color)는 전달받은 color를 이용해서 Color 객체를 만들어 줌.

    /**
     * Color.toArray()는 Color 객체에 지정된 컬러값을 0 ~ 1 사이의 [r, g, b] 배열로 변환하여 리턴해 줌.
     * 이 리턴받은 배열을 map을 이용해서 0 ~ 1 사이의 값을 0 ~ 255 사이의 값으로 변환한 새로운 배열을 구해서 리턴해준 것.
     * 
     * -> 결과적으로 전달받은 color를 0 ~ 255 사이의 값으로 표현된 [r, g, b] 배열로 변환해서 리턴해주겠네
     */
    return tempColor.toArray().map(v => v * 255);
  }

  // 인덱스 팔레트 기법에 사용할 팔레트 텍스처를 DataTexture를 사용하여 만들어줄거임. 인덱스 팔레트에 대한 자세한 설명은 튜토리얼 웹사이트 참고
  // maxNumCountries는 팔레트 텍스처에 몇 개의 픽셀에 각각 서로 다른 색상을 지정해줄 것인지 결정하는 값. 
  // 즉, 나라별 색상 + 바다 색상 개수니까 대략 전세계 국가 240여개와 비슷한 개수로 하면 되지만, 일단은 그거보다 큰 숫자만큼 색상을 지정해준다고 문제될 건 없으니 512 정도의 여유로운 숫자로 지정한 것. 
  const maxNumCountries = 512;
  const paletteTextureWidth = maxNumCountries; // 팔레트 텍스처의 너비와 칠해줄 색상의 개수를 동일하게 해줌. -> 1px마다 각기 다른 색상이 칠해지겠지
  const paletteTextureHeight = 1; // 높이는 1px인 DataTexture가 만들어지겠네
  // DataTexture에 전달해 줄 각 픽셀들의 컬러값을 넣어줄 형식화 배열을 생성한거임. 
  // 일단 512개의 색상의 각 r, g, b값들이 필요하니 512 * 3 만큼 형식화 배열의 길이를 지정해준 것이고, 실제 r, g, b값은 아래에서 for loop를 돌며 랜덤으로 지정해줄거임.
  const palette = new Uint8Array(paletteTextureWidth * 3);
  // DataTexture 메서드는 raw data(위에 Uint8Array로 만든 512 * 3 길이의 픽셀별 색상데이터), width, height을 받아서 텍스처를 생성함.
  // 이때 THREE.RGBFormat으로 형식을 지정했기 때문에, 색상데이터는 r, g, b값까지만 지정해줄거임.
  const paletteTexture = new THREE.DataTexture(
    palette, paletteTextureWidth, paletteTextureHeight, THREE.RGBFormat
  );
  paletteTexture.minFilter = THREE.NearestFilter;
  paletteTexture.magFilter = THREE.NearestFilter; // 만들어진 텍스처가 원본보다 작아지거나 커질 때 NearestFilter로 처리해 주도록 함.

  // palette 형식화 배열을 돌면서 512개의 각 색상의 r, g, b값들을 0 ~ 256 사이의 랜덤값으로 할당함으로써, 512개의 랜덤한 색상을 만들어 줌.
  // for (let i = 1; i < palette.length; i++) { // 1번째 인덱스부터 for loop를 시작하는 이유는 0번째 인덱스부터는 바다색의 r, g, b값을 직접 지정하기 위한 것.
  // palette[i] = Math.random() * 256;
  // }
  // 단, 형식화 배열의 0번째부터 2번째 인덱스까지는 바다색의 r, g, b값을 for loop 말고 직접 지정해 줌. 
  // 참고로 TypedArray.set([a, b, c, ...], i) 이렇게 해주면, 해당 형식화 배열의 i번째 인덱스부터 시작해서 a, b, c, ... 로 값들을 순서대로 덮어써 줌.
  // palette.set([100, 200, 255], 0);
  // paletteTexture.needsUpdate = true; // 팔레트 텍스처가 교체한 쉐이더 조각에서 사용될 때마다 업데이트를 트리거 해주도록 함.

  // 위에서 작성한 코드는 팔레트 텍스처가 잘 작동하는지 확인해보려고 각 나라 영역에 랜덤 컬러값을 생성해서 칠해주는 코드를 작성한 것.
  // 이제는 바다 색, 선택영역 색, 선택안한 영역 색으로만 palette 형식화 배열을 채워줄거임.
  const selectedColor = get255BasedColor('red'); // 선택영역 색은 red의 r, g, b 배열로 할당함
  const unselectedColor = get255BasedColor('#444'); // 선택안한 영역 색은 grey 계열 컬러의 r, g, b 배열로 할당함.
  const oceanColor = get255BasedColor('rgb(100, 200, 255)'); // 바다 색은 blue 계열 컬러의 r, g, b 배열로 할당함.
  resetPalette(); // palette 형식화 배열의 0 ~ 2번째 까지는 바다 색 r, g, b로 채우고, 나머지는 모두 선택안한 영역 색 r, g, b로 채워버림

  // 전달받은 index값, color 배열을 이용해서, palette 형식화 배열의 index*3 번째 인덱스부터 전달받은 컬러의 r, g, b값을 채워주는 함수
  function setPaletteColor(index, color) {
    palette.set(color, index * 3); // 왜 index*3 번째냐면, 각 픽셀들의 컬러마다 r, g, b 각각 3개의 값들을 넣어줄 인덱스 자리가 필요하니까.. 
  }

  // palette 형식화 배열의 모든 픽셀 색상을 unselectedColor의 r, g, b값으로 채우고, 0 ~ 2번 인덱스까지만 oceanColor의 r, g, b값으로 채움
  function resetPalette() {
    // 위에서는 palette.length만큼 for loop를 돌렸는데 여기서는 왜 maxNumCountries 즉, 512번만 돌려주는걸까? 
    // selectedColor에서 길이가 3개인 배열을 바로 palette에 넣어주기 때문에, 위에서 처럼 512 * 3번(= palette.length) 만큼 돌려줄 필요가 없음. 
    for (let i = 1; i < maxNumCountries; i++) {
      setPaletteColor(i, unselectedColor);
    }

    // oceanColor의 r, g, b값은 0 ~ 2번째 인덱스에 따로 지정해 줌.
    setPaletteColor(0, oceanColor);
    paletteTexture.needsUpdate = true; // 위에서 주석처리한 코드처럼 팔레트 텍스처가 교체한 쉐이더 조각에서 사용될 때마다 업데이트를 트리거하도록 함.
    // 그니까 이게 정확히 뭐냐면, 지금 paletteTexture에 들어간 형식화 배열 palette의 배열요소를 일부 수정했잖아. 그러면 이것이 적용된 paletteTexture를 바로 업데이트하는게 아니고,
    // 나중에 쉐이더 조각이든 어디선가든 해당 DataTexture가 사용되는 순간 수정된 형식화 배열이 적용된 DataTexture로 업데이트 해준다는 거임.
    // 어쨋든 DataTexture의 일부분을 수정했다면, 나중에 해당 텍스처가 사용될 때 수정된 부분이 업데이트될 수 있도록 업데이트 트리거를 미리 예약해놓아야 함. 
  }

  // 세계지도 윤곽선 텍스처를 로드해서 구체를 만들 때 텍스처로 입혀줌.
  {
    const loader = new THREE.TextureLoader();
    const geometry = new THREE.SphereGeometry(1, 64, 32);

    // 피킹용 텍스처가 로드되지 않은 상태에서 render 함수를 실행해버리면 피킹용 텍스처가 필요한 작업을 제대로 수행하기 어려우니, 텍스처가 로드되고 나서 한 번 더 호출해주려는 것 같음.
    const indexTexture = loader.load('https://threejsfundamentals.org/threejs/resources/data/world/country-index-texture.png', render); // 피킹용 텍스처를 로드해 옴
    indexTexture.minFilter = THREE.NearestFilter;
    indexTexture.magFilter = THREE.NearestFilter; // 원본이 텍스처보다 크거나 작을때 THREE.NearestFilter를 이용해서 텍스처의 픽셀을 처리해 줌. 

    const pickingMaterial = new THREE.MeshBasicMaterial({
      map: indexTexture
    });
    pickingScene.add(new THREE.Mesh(geometry, pickingMaterial)); // 피킹용 지구본을 만든 뒤 피킹용 씬에 추가해 줌.

    /**
     * 세계지도 윤곽선 텍스처가 입혀진 베이직 머티리얼의 색상값을 바꿔주려면 어떻게 해야할까?
     * Material.onBeforeCompile에 함수를 지정하면, material의 내장 쉐이더를 수정해줄 수 있는데, 
     * 이를 통해서 해당 머티리얼에 적용된 텍스처의 컬러값을 바꿔줄 수 있음.
     * 
     * 그래서 optimizing 예제에서 했던 것처럼 머티리얼의 fragmentShader 내장 쉐이더 조각을 수정하려면
     * 그래서 일단 교체하려는 fragmentShader 쉐이더 조각들이 담긴 배열을 만들어놓은 것.
     * 
     * 이 배열의 각 객체들이 의미하는 바는, from에는 material의 내장 쉐이더에 원래부터 있었던 쉐이더 조각이 할당되어 있고,
     * to에는 'from에 있는 쉐이더 조각을 이거로 바꿀거에요' 라는, 즉 교체하고자 하는 쉐이더 문자열을 할당해 놓은 것.
     */
    const fragmentShaderReplacements = [{
        from: '#include <common>',
        to: `
          #include <common>
          uniform sampler2D indexTexture;
          uniform sampler2D paletteTexture;
          uniform float paletteTextureWidth;
        `,
        /**
         * 3개의 균등변수들을 각각 설명해보자면
         * 
         * indexTexture는 말 그대로 위에서 로드한 피킹용 텍스처,
         * paletteTexture는 인덱스 팔레트 기법에 사용하기 위해 만든, 각 픽셀마다 나라별로 할당할 고유한 컬러들이 칠해진 DataTexture 객체,
         * paletteTextureWidth는 해당 DataTexture 객체의 width값을 의미함.
         */
      },
      {
        from: '#include <color_fragment>',
        to: `
          #include <color_fragment>
          {
            vec4 indexColor = texture2D(indexTexture, vUv); // vUv는 Three.js가 넘겨주는 피킹용 텍스처의 모든 좌표값들임. 이 좌표값들 하나하나마다 색상값을 불러와 indexColor에 저장하는거지
            float index = indexColor.r * 255.0 + indexColor.g * 255.0 * 256.0; // 가져온 피킹용 텍스처의 각 좌표별 색상값으로 index값으로 변환하고
            vec2 paletteUV = vec2((index + 0.5) / paletteTextureWidth, 0.5); // 이 인덱스값으로 paletteTexture에서 뽑아오고자 하는 컬러가 칠해진 지점이 좌표값을 구하고
            vec4 paletteColor = texture2D(paletteTexture, paletteUV); // paletteTexture에서 paletteUV 지점을 찾아 그곳의 컬러값을 paletteColor에 할당함.
            // diffuseColor.rgb += paletteColor.rgb;   // 하얀 윤곽선
            diffuseColor.rgb = paletteColor.rgb - diffuseColor.rgb;  // 검은 윤곽선
          }
        `,
        /**
         * 위에 하얀 윤곽선, 검은 윤곽선이라고 주석 처리해준 게 무슨 의미냐면,
         * diffuseColor.rgb는 세계지도 윤곽선 텍스처의 원래 색상들 즉, 검은색(0x000000) 면색과 흰색(0xFFFFFF) 윤곽선색이 담겨있음.
         * 
         * 여기에 인덱스 팔레트 기법으로 뽑아낸 새로운 색상값을 
         * 1. 더해주면, 0x000000 + 새로운 색상값 = 새로운 색상값, 0xFFFFFF + 새로운 색상값 = 0xFFFFFF(왜냐면 16진수에서 가장 큰 수이기 때문.) 이므로 새로운 색상값의 면색과 하얀 윤곽선이 된다는 뜻이고,
         * 2. 색상값에서 diffuseColor값을 빼주면, 새로운 색상값 - 0x000000 = 새로운 색상값, 새로운 색상값 - 0xFFFFFF = 0x000000(왜냐면 어떤 16진수든 가장 큰 16진수를 빼주면 0이 되니까.) 이므로 새로운 색상값의 면색과 검은 윤관선이 된다는 뜻임
         */
      },
    ];

    // .load 메서드의 onLoad 함수를 render로 넘겨줘서 텍스처 로드가 완료되면 render 함수를 한 번 더 호출시켜줌.
    const texture = loader.load('https://threejsfundamentals.org/threejs/resources/data/world/country-outlines-4k.png', render);
    const material = new THREE.MeshBasicMaterial({
      map: texture
    }); // 조명의 영향을 받지 않아도 되므로 베이직-머티리얼로 사용하면 됨.
    material.onBeforeCompile = function (shader) { // 위에서 만든 베이직-머티리얼의 onBeforeCompile에 함수를 지정하면 내장 쉐이더를 수정할 수 있는데, 이때 지정해주는 함수는 해당 머티리얼의 내장 쉐이더 코드를 인자로 받을 수 있음.
      fragmentShaderReplacements.forEach((rep) => {
        // 인자로 전달받은 베이직-머티리얼 내부의 쉐이더 코드에서 fragmentShader 문자열을 가져온 뒤, rep.from에 해당하는 부분을 rep.to로 교체한 새로운 쉐이더 코드 문자열을 리턴받아 shader.fragmentShader에 덮어씀
        // 그러면 fragmentShaderReplacements 배열에서 지정한대로 우리가 교체하길 원하는 쉐이더 조각들이 머티리얼의 내장 쉐이더에 들어가겠지?
        shader.fragmentShader = shader.fragmentShader.replace(rep.from, rep.to);
      });

      // 또한 교체가 완료된 내장 쉐이더의 uniforms(균등변수)에 우리가 실제로 위에서 만들었던 텍스처들을 할당해줘야 함.
      shader.uniforms.paletteTexture = {
        value: paletteTexture
      };
      shader.uniforms.indexTexture = {
        value: indexTexture
      };
      shader.uniforms.paletteTextureWidth = {
        value: paletteTextureWidth
      };
    };
    scene.add(new THREE.Mesh(geometry, material));
  }

  // 지구본의 각 지역에 관한 JSON 데이터가 담긴 HTTP Response를 fetch(url)로 비동기로 받아와서 json() 메서드를 이용해 실제 JSON 오브젝트로 변환해 리턴해주는 함수
  async function loadJSON(url) {
    const req = await fetch(url);
    return req.json();
  }

  // 나라를 선택할 때마다 선택한 나라들의 개수를 카운트해주는 변수
  let numCountriesSelected = 0;
  // 비동기로 가져온 JSON 데이터(각 나라별 이름, 위도, 경도, min, max(각 나라별 영역의 bounding box의 사이즈를 구하기 위한 최소, 최대 위,경도 좌표값이라고 해야하나?))를 담아놓을 변수
  let countryInfos;
  // 각 나라별로 위, 경도만큼 헬퍼 객체들을 회전시켜서 각 나라별 이름표의 전역공간 좌표값을 구해놓고, 이름표 요소를 생성해놓는 함수
  // loadJSON 함수가 비동기로 처리되기 때문에, 이것을 내부에서 실행하는 loadCountryData 함수도 비동기로 실행해줘야 함. 
  async function loadCountryData() {
    countryInfos = await loadJSON('https://threejsfundamentals.org/threejs/resources/data/world/country-info.json'); // 일단 JSON 데이터를 리턴받음.

    // 이 각도값들은 각각 lonHelper, latHelper의 회전각도를 구할 때 사용됨.
    const lonFudge = Math.PI * 1.5; // 270도
    const latFudge = Math.PI; // 180도

    // 헬퍼 Object3D 객체들을 만든 뒤, 위, 경도값만큼 회전해서 이름표들의 변화하는 전역 공간상의 위치값을 쉽게 계산하려는 것.
    const lonHelper = new THREE.Object3D(); // 얘는 Y축으로 회전시켜서 경도를 맞춤.
    const latHelper = new THREE.Object3D(); // 얘는 X축으로 회전시켜서 위도를 맞춤.
    lonHelper.add(latHelper);
    const positionHelper = new THREE.Object3D();
    positionHelper.position.z = 1; // 왜 1로 했을까? 지구본이 radius를 1로 했기 때문에!
    latHelper.add(positionHelper);

    // 이름표 요소들을 생성해 자식노드로 추가해 줄 부모 요소를 가져옴
    const labelParentElem = document.querySelector('#labels');

    for (const countryInfo of countryInfos) {
      const {
        lat,
        lon,
        min,
        max,
        name
      } = countryInfo;

      // JSON 데이터 안의 각 나라별 lon, lat 값을 이용하여 회전각을 구해 헬퍼 Object3D들을 회전시켜 줌
      lonHelper.rotation.y = THREE.MathUtils.degToRad(lon) + lonFudge;
      latHelper.rotation.x = THREE.MathUtils.degToRad(lat) + latFudge;

      positionHelper.updateWorldMatrix(true, false); // Object3D.updateWorldMatrix(updateParents, updateChildren)는 해당 객체의 전역 transform(위치, 회전, 크기 변경 등)이 바뀌면 그거를 업데이트해줌. 
      const position = new THREE.Vector3(); // positionHelper의 전역공간 좌표값을 복사해서 넣어줄 Vec3 생성해놓음
      positionHelper.getWorldPosition(position); // Object3D.getWorldPosition(Vector3)는 전달한 Vec3에 객체의 전역공간상의 좌표값을 구해서 복사해 줌.
      countryInfo.position = position; // 나라별 JSON 데이터 객체 안에 position 속성값을 추가하여 위에서 구한 이름표의 전역공간 좌표값을 넣어놓음

      // min, max값을 이용해서 각 나라의 영역 크기를 계산하여 영역이 큰 나라부터 우선적으로 보여주도록 할거임.
      const width = max[0] - min[0]; // 아마 max[0], min[0]은 영역에서 각각 최대, 최소 x좌표값 같음.
      const height = max[1] - min[1]; // max[1], min[1]은 영역에서 각각 최대, 최소 y좌표값 같음.
      const area = width * height;
      countryInfo.area = area; // 계산해준 각 나라 영역 넓이값을 area 라는 속성값을 만들어 할당해놓음

      // 각 나라별 이름표 요소를 생성해서 이름표들의 부모요소에 추가해줌
      const elem = document.createElement('div');
      elem.textContent = name;
      labelParentElem.appendChild(elem);
      countryInfo.elem = elem; // elem 속성값도 추가해서 생성한 이름표 요소를 넣어놓음.
    }

    requestAnimateIfNotRequested(); // 전역공간 좌표값을 구하고, 이름표를 생성하고 나서 render 함수를 한 번 더 호출해 줌
  }

  loadCountryData();

  // loadCountryData에서 구한 각 이름표의 전역 좌표값을 정규화된 NDC좌표값으로 변환해놓을 Vec3 생성
  const tempV = new THREE.Vector3();

  // updateLabels 함수에서 스칼라곱에 필요한 정규화된 방향 벡터들을 구하기 위해 필요한 Vec3 및 Mat3 값들 생성
  const cameraToPoint = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  // 이름표 표시 여부를 결정하는 영역넓이를 결정하는 길이값(?)과 코사인 값을 객체로 묶어서 지정해놓음.
  const settings = {
    minArea: 20,
    maxVisibleDot: -0.2
  };

  // 예제 1번처럼 각 이름표의 전역 좌표값을 정규화된 NDC 좌표값으로 변환해서 현재 캔버스 해상도에 맞는 좌표값으로 변환해주는 함수
  function updateLabels() {
    if (!countryInfos) {
      // render 함수 내에서 이 함수가 호출되었을 때, 아직 JSON 데이터를 로드해오지 못해서 countryInfos가 비어있다면, if block으로 들어온 뒤 이 함수를 끝내버림.
      return;
    }

    // dat.GUI에서 받은 입력값을 제곱하여 기준이 될 영역넓이값 large를 구해놓음
    const large = settings.minArea * settings.minArea;

    // 카메라의 전역 행렬변환을 정규 행렬로 변환하여 normalMatrix에 저장함
    normalMatrix.getNormalMatrix(camera.matrixWorldInverse);
    // 카메라의 전역공간 위치값을 복사하여 cameraPosition에 복사함
    camera.getWorldPosition(cameraPosition);

    for (const countryInfo of countryInfos) {
      const {
        position,
        elem,
        area,
        selected
      } = countryInfo; // 얘내는 loadCountryData에서 만들어서 각 countryInfo에 넣어놨던 속성값들을 다시 불러오는 것
      const largeEnough = area >= large; // 해당 나라의 영역넓이가 기준 영역넓이보다 넓은지 판단하는 변수
      /**
       * 1. 해당 나라의 selected가 true이거나
       * 2. 해당 나라의 영역넓이가 기준 영역넓이보다 넓고, 현재 선택된 나라가 없(거나 선택된 나라들이 초기화됬)다면
       * 
       * show에 true를 할당해줘서 아래 if block을 패스하도록 하여 해당 나라의 이름표 요소를 숨기지 않도록 함  
       */
      const show = selected || (numCountriesSelected === 0 && largeEnough);
      if (!show) {
        elem.style.display = 'none';
        continue; // 여기서도 마찬가지로 이름표를 안보여줄거면 굳이 아래의 계산을 해줄 필요가 없으니 다음 반복 순회로 넘어가라고 하는 것.
      }

      // 구체의 중점에서 이름표 요소까지의 방향을 나타내는 단위벡터를 구하는 것 같은데 자세한 원리는 모르겠음...
      tempV.copy(position);
      tempV.applyMatrix3(normalMatrix);

      // 카메라로부터 이름표까지의 방향을 나타내는 단위벡터를 구하는 것 같은데 자세한 원리는 모르겠음...
      cameraToPoint.copy(position);
      cameraToPoint.applyMatrix4(camera.matrixWorldInverse).normalize();

      const dot = tempV.dot(cameraToPoint); // 위에서 구한 두 단위벡터를 스칼라곱 해줘서 각도의 cos값을 얻어냄

      if (dot > settings.maxVisibleDot) {
        elem.style.display = 'none';
        continue; // for...of 반복문에서 사용된 continue 이므로, 현재까지의 반복 순회를 중단하고, 다음 반복 순회로 넘어가도록 함.
      }

      // 만약 dot이 maxVisibleDot보다 작아서 if block을 패스하고 왔다면, 이전에 해당 이름표가 숨겨졌을 수도 있으니 초기의 display값을 적용해준 것.
      elem.style.display = '';

      tempV.copy(position); // 각 이름표의 전역공간 좌표값을 tempV에 복사해줌
      tempV.project(camera); // 전역공간 좌표값을 정규화된 NDC 좌표값으로 변환해 줌.

      // 이런 식으로 정규화된 좌표값을 캔버스 좌표계에 맞게 방향과 범위를 수정해준 뒤, 캔버스의 css 사이즈만 곱해주면 캔버스 상의 좌표값으로 만들어버릴 수 있음
      const x = (tempV.x * 0.5 + 0.5) * canvas.clientWidth;
      const y = (tempV.y * -0.5 + 0.5) * canvas.clientHeight;

      // 이름표 요소를 위에서 구한 캔버스 좌표값으로 옮겨줌.
      elem.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;

      // 각 이름표 요소들의 정규화된 z좌표값을 0 ~ 100000 사이의 정수값으로 변환해서 이름표 요소의 z-index로 할당함
      elem.style.zIndex = (-tempV.z * 0.5 + 0.5) * 100000 | 0;
    }
  }

  // GPUPickingHelper는 1*1 렌더타겟에 1*1 카메라로 찍은 마우스 좌표값 바로 아래 피킹용 씬 지점을 렌더하도록 구현함.
  class GPUPickHelper {
    constructor() {
      this.pickingTexture = new THREE.WebGLRenderTarget(1, 1); // 1*1px 크기의 렌더 타겟 생성
      this.pixelBuffer = new Uint8Array(4); // 픽셀 데이터값(r, g, b, a)를 지정할 총 4개의 길이를 갖는 형식화 배열 생성. readRenderTargetPixels 메서드가 형식화배열만 받기 때문에 만든 것.
    }

    // pick 메서드 호출 시 pointerup 이벤트 좌표값, 피킹용 씬을 전달함.
    pick(cssPosition, scene, camera) {
      const {
        pickingTexture,
        pixelBuffer
      } = this; // 생성자 안의 속성들을 각각의 const에 할당

      // camera.setViewOffset을 이용하여 렌더러의 width, height을 기준으로 마우스 포인터 아래 1*1 지점으로 view offset을 설정함.
      const pixelRatio = renderer.getPixelRatio(); // 현재 렌더러의 devicePixelRatio를 가져옴
      camera.setViewOffset(
        renderer.getContext().drawingBufferWidth, // 현재 렌더러의 드로잉버퍼 width = 렌더러의 width를 전체 너비로 지정
        renderer.getContext().drawingBufferHeight, // 현재 렌더러의 드로잉버퍼 height = 렌더러의 height을 전체 높이로 지정
        cssPosition.x * pixelRatio | 0, // pointerup 이벤트 x좌표값에 pixelRatio를 곱한 뒤(렌더러의 pixelRatio 기준 해상도에서의 좌표값과 받아온 clientX, Y좌표값이 다를수도 있으니까), 비트연산자로 소수점 제거하여 view offset의 x좌표로 지정함.
        cssPosition.y * pixelRatio | 0, // pointerup 이벤트 y좌표값에 pixelRatio를 곱한 뒤, 비트연산자로 소수점 제거하여 view offset의 y좌표로 지정함.
        1,
        1, // view offset의 width, height을 각각 1로 지정
      );

      renderer.setRenderTarget(pickingTexture) // 렌더러가 활성화할 렌더 대상을 생성자에서 만든 1*1 렌더 타겟으로 지정함.
      renderer.render(scene, camera) // 피킹용 씬, pointerup 지점에 1*1 사이즈의 viewOffset이 임시로 지정된 카메라를 넘겨주면서 1*1 렌더타겟에 피킹용 씬의 1*1 부분만큼만 렌더해 줌
      renderer.setRenderTarget(null); // render 메서드에서 원래 캔버스에 다시 렌더해줘야 하므로 렌더 대상을 원래의 캔버스로 초기화함.
      camera.clearViewOffset(); // 위에서 카메라에 임시로 만들어 둔 1*1 사이즈의 viewOffset도 지워버림. 원래 캔버스에 렌더할 때는 전체 씬을 찍어줘야 하니까

      // 1*1 사이즈의 렌더타겟(pickingTexture)의 1px의 픽셀데이터를 4개의 길이를 갖는 Uint8Array 형식화 배열(pixelBuffer)에 r, g, b, a를 순서대로 복사해 줌.
      renderer.readRenderTargetPixels(
        pickingTexture,
        0, // x
        0, // y
        1, // width
        1, // height 즉, 전달해 준 pickingTexture 렌더 타겟이 1*1 사이즈니까 전체 영역의 픽셀 데이터를 가져온다는 거지.
        pixelBuffer // 여기에 해당 픽셀의 r, g, b, a값을 순서대로 복사해 줌.
      );

      // Uint8Array에 이진 데이터로 저장된 r, g, b값을 십진수 정수로 바꿔서 고유한 색상값의 id이자 각 나라의 index값으로 활용할거임.
      const id =
        (pixelBuffer[0] << 0) |
        (pixelBuffer[1] << 8) |
        (pixelBuffer[2] << 16);

      return id; // 십진수 정수값인 id값을 리턴해 줌.
    }
  }

  const pickHelper = new GPUPickHelper(); // GPUPickHelper 객체를 생성함.

  /**
   * 클릭 인식과 관련한 두 가지 문제를 해결하고자 함.
   * 
   * 1. 지구본을 돌리고 있는데도 나라가 선택된다.
   * 2. 나라를 선택하고 지구본을 돌리려고 드래그하면 선택이 풀려버린다.
   * 
   * 이 두 개의 문제는 현재 코드에서 '드래그'와 '코드'를 제대로 구분하지 못하기 때문에 발생함.
   * 
   * 이 둘을 구분하는 방법은 다음과 같다
   * 1. 마우스를 클릭한 후 떼는 데 시간이 얼마나 흘렀는지 확인한다.
   * 2. 포인터가 기준 길이 이상으로 움직였는지를 확인한다.
   * 
   * 결론적으로 '마우스를 떼는 데 시간이 기준 시간보다 짧고(and) 포인터가 움직인 길이가 기준 길이보다 짧아야'
   * 마우스를 '클릭'으로 간주하여 함수를 계속 진행하고, 기준 시간보다 오래걸렸거나(or) 기준 길이보다 길다면 '드래그'로 간주하여 함수를 멈춤. -> pickCountry의 if block들이 이런 논리로 설계되어있음. 확인해볼 것.
   */
  const maxClickTimeMs = 200; // 클릭 후 마우스를 떼는 데 걸리는 기준 시간을 200ms로 정함
  const maxMoveDeltaSq = 5 * 5; // 포인터가 움직인 기준 길이를 5px로 정함. 정확히는 저 값은 Math.sqrt(Math.pow(x좌표 움직인 거리) + Math.pow(y좌표 움직인 거리)) 공식에서 제곱근을 도출하기 직전의 값이긴 한데, 어쨋든 제곱근을 구해서 움직인 길이를 구하면 5가 나올테니 기준길이를 5라고 봐도 되겠지
  const startPosition = {}; // pointerdown 이벤트가 발생한 시작지점의 좌표값을 기록해두는 객체
  let startTimeMs; // pointerevent 이벤트가 발생한 시점의 시간값을 기록해두는 변수

  function recordStartTimeAndPosition(e) {
    /**
     * performance는 window 전역객체의 내장 객체로써, 현재 페이지의 성능 관련 정보에 접근할 수 있는 API이다.
     * performance.now() 메서드는 time origin으로부터 경과된 시간을 밀리초 단위로 리턴해주는데,
     * time origin은 일반적으로 브라우저창 컨텍스트가 생성된 시점을 원점으로 삼고 있음.
     * 
     * 즉, 브라우저 창이 생성된 시점부터 performace.now()가 호출된 시점까지의 경과한 시간을 밀리초 단위로 리턴해준다는 뜻
     * 
     * 그래서 일반적으로 함수가 실행되는데 얼마나 시간이 소요되는지 확인할 때,
     * 
     * const t0 = performance.now();
     * 힘수();
     * const t1 = performance.now();
     * 
     * 이런 식으로 활용해서 함수의 실행시간을 측정하는 방법으로 사용하기도 함.
     */
    startTimeMs = performance.now(); // 일단 브라우저가 생성된 후 pointerdown이벤트가 발생한 시점(발생해야 recordStartTimeAndPosition가 호출되니까)까지의 경과시간을 할당해놓음

    // pointerdown 이벤트가 발생한 지점의 좌표값을 캔버스의 상대적 좌표값으로 변환하여 기록해놓음.
    const pos = getCanvasRelativePosition(e);
    startPosition.x = pos.x;
    startPosition.y = pos.y;
  }

  // pointerup 이벤트 좌표값을 받아 캔버스의 상대적 좌표값으로 변환하는 함수
  function getCanvasRelativePosition(e) {
    const rect = canvas.getBoundingClientRect(); // 캔버스 요소의 DOMRect 객체를 리턴받음.

    return {
      x: (e.clientX - rect.left) * canvas.width / rect.width,
      y: (e.clientY - rect.top) * canvas.height / rect.height
    }
  }

  // 피킹용 텍스처의 pointerup 지점의 고유한 색상값으로 id값을 구한 뒤, 해당 id값을 index로 갖는 countryInfo 객체와, 그 외의 countryInfo 객체들의 select 속성을 켜거나 끄는 함수 -> 어떤 나라가 선택됬는지 여부를 지정해주는 것.
  function pickCountry(e) {
    // JSON 데이터가 아직 로드되지 않아서 countryInfos가 비어있다면 함수를 중단함.
    if (!countryInfos) {
      return;
    }

    // pickCountry는 pointerup이벤트가 발생해야, 즉 마우스를 떼야 호출되므로, 이 시점에서 performance.now()를 다시 호출하여 리턴받은 경과시간에 startTimeMs를 빼면 클릭 후 마우스를 뗄 때까지의 경과시간이 clickTimeMs에 할당될거임.
    const clickTimeMs = performance.now() - startTimeMs;
    if (clickTimeMs > maxClickTimeMs) {
      // 클릭 후 마우스를 뗄 때까지의 경과시간이 기준시간(200ms)보다 오래걸렸다면, '드래그'로 인식해서 pickCountry 함수를 여기서 중단하고, 짧게 걸렸다면 '클릭'으로 인식해서 아래 코드를 계속 진행함
      return;
    }

    // 이번에는 마우스를 클릭한 지점부터 뗀 지점까지 얼마나 이동했는지 이동 거리를 계산하여 기준 거리보다 짧은지 긴지 비교함
    const position = getCanvasRelativePosition(e); // pointerup 즉, 마우스를 뗀 지점의 캔버스 상대적 좌표값을 구해줌
    // Math.sqrt(Math.pow(x좌표 움직인 거리) + Math.pow(y좌표 움직인 거리)) 공식에서 Math.sqrt로 제곱근을 구해주기 전까지의 값을 moveDeltaSq에 할당함.
    const moveDeltaSq = (startPosition.x - position.x) ** 2 + (startPosition.y - position.y) ** 2; // 밑 ** 지수 에서 **는 지수연산자로 불리며, 첫번째 피연산자는 밑, 두번째 피연산자는 지수로 계산해 줌. 지금 지수가 2니까 제곱을 하는거지?
    if (moveDeltaSq > maxMoveDeltaSq) {
      // 클릭 후 마우스를 뗄 때까지의 이동거리가 기준거리(5)보다 길다면, '드래그'로 인식해서 함수를 중단, 짧게 걸렸다면 '클릭'으로 인식해서 아래 코드들을 계속 진행함.
      return;
    }

    const id = pickHelper.pick(position, pickingScene, camera); // 클릭한 지점의 픽셀 색상값 데이터에서 id값을 계산하여 할당받음.
    if (id > 0) {
      // 피킹용 텍스처에는 나라 영역은 검은색(0x000000)은 없고, 오직 피킹용 씬의 배경색과 피킹용 텍스처의 바다 부분만 0x000000임(피킹용 텍스처의 바다 부분의 투명도가 0인 png 파일이니까). 
      // 따라서 id가 0이 아니라면, 어떤 나라 영역이 선택된 것이므로 if block 으로 들어와서 실행해 줌.  
      const countryInfo = countryInfos[id - 1]; // id는 0이 아닌 값만 들어오겠지만 countryInfos는 0부터 시작하므로 id - 1을 해줘야 첫번째 countryInfo를 빼먹지 않겠지
      // 기본적으로 pickCountry가 처음 호출되면 모든 countryInfo 객체들의 selected는 undefined이고, 처음이 아니라면 이전에 선택된 나라를 제외하면 false이므로, 
      // !countryInfo.selected는 selected에 true를 할당해준다고 볼 수 있음. 이게 false가 되려면 이전에 선택한 나라를 중복 클릭하면 false가 되겠지?
      const selected = !countryInfo.selected;

      if (selected && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // 이거는 뭐냐면, selected에 true가 할당되면 이전에 선택되지 않은 새 나라가 선택되었는데, 
        // 이 상태에서 만약 pointerup 이벤트가 shift, ctrl, cmd 등 특수키와 같이 눌리지 않았다면 if block을 들어와서 모든 나라들의 selected 속성값을 false로 꺼버리고, 선택된 나라 개수 카운팅을 0으로 초기화함.
        // 같이 눌렸다면 if block을 패스하니까 기존의 selected가 true인 게 있을 경우 그것을 끄지 않고 내버려 두고, 선택된 나라 개수 카운팅도 내버려 둠.
        // 즉, 저 특수키들을 누른 상태에서 나라를 클릭하면 이전에 클릭해서 화면에 보이는 이름표 요소들이 없어지지 않고 그대로 있도록 함. -> 나라들을 다중 선택할 수 있도록 해주는 거임.
        unselectAllCountries();
      }
      numCountriesSelected += selected ? 1 : -1; // selected가 true면 이전에 선택되지 않은 새 나라가 선택되었다는 뜻이니 선택된 나라 개수를 +1 해야 할 것이고, 이전에 선택된 나라를 중복 선택했다면 선택된 나라 개수를 -1로 해버림 
      countryInfo.selected = selected; // 지금 선택된 나라의 selected 값을 할당해 줌.

      // selected가 true라면, 현재 나라의 고유한 index값과 selectedColor를 넘겨주면서 setPaletteColor를 호출하여 palette 형식화 배열에서 id * 3번째의 인덱스부터 selectedColor(빨강색)의 r, g, b값을 차례대로 지정함. 
      // false라면, unselectedColor를 대신 넘겨주면서 palette 형식화 배열에서 id * 3번째 인덱스부터 unselectedColor(어두운 회색)의 r, g, b값을 차례대로 지정함.
      setPaletteColor(id, selected ? selectedColor : unselectedColor);
      // 얘도 위에서 했던 것과 마찬가지로, DataTexture에 들어가는 형식화 배열인 palette의 일부 요소들을 수정해줬으므로, 수정한 부분이 반영된 DataTexture로 업데이트 해주려면
      // 지금 당장 업데이트되는 것이 아닌, 해당 텍스처가 쉐이더 조각이든 어디선가든 사용되는 순간 업데이트가 적용되도록 트리거 예약을 미리 걸어놓는거임.
      // 그럼 쉐이더 조각에서 paletteTexture를 사용하여 paletteColor를 할당하려는 순간, 형식화 배열의 몇몇 요소가 수정된 텍스처로 업데이트되겠지 
      paletteTexture.needsUpdate = true;
    } else if (numCountriesSelected) {
      // id가 0인 경우, 즉 바다나 배경을 클릭한 경우, numCountriesSelected가 0이 아니라면, 즉 몇 개의 나라들이 클릭되어서 걔내들의 이름표 요소만 보이는 상태라면,
      // 모든 나라의 selected와 카운팅을 초기화해줌. -> 이런 식으로 numCountriesSelected가 0이 되면 selected가 true가 아니어도 기준 영역 넓이 이상인 나라들의 이름표를 모두 보이게 함.
      unselectAllCountries();
    }

    requestAnimateIfNotRequested(); // 항상 pointerup 이벤트로 인해 pickCountry 함수가 실행되고 나면 마지막에 render 함수를 호출하여 그 안의 updateLabels 함수에서 selected가 변경된 나라들의 이름표 요소를 보여주거나 숨겨서 업데이트 해줌.
  }

  // 모든 나라의 selected 값을 false로 꺼버리고, 선택된 나라 개수 카운팅도 0으로 초기화하는 함수
  function unselectAllCountries() {
    numCountriesSelected = 0;
    countryInfos.forEach((countryInfo) => {
      countryInfo.selected = false;
    });
    // 선택된 나라들을 모두 초기화하는 함수에서 paletteTexture에 사용된 palette 형식화 배열도 모두 어두운 회색의 r, g, b와 바다 색 r, g, b(0 ~ 2번 인덱스만)로 리셋해버림.
    // 형식화 배열을 수정했으니 needsUpdate로 업데이트 트리거를 예약해야되지 않을까? resetPalette 함수 내에서 자체적으로 해주기 때문에 안해줘도 됨.
    resetPalette();
  }

  canvas.addEventListener('pointerdown', recordStartTimeAndPosition); // 클릭과 드래그 인식을 구분하기 위해 pointerdown 이벤트 발생 시점의 시간과 위치값을 기록해두는 함수를 호출함
  canvas.addEventListener('pointerup', pickCountry); // 캔버스에서 마우스나 터치를 뗄 때마다 pickCountry를 호출해서 선택된 나라가 있는지 판단하여 selected값과 numCountriesSelected 값을 업데이트해줌. 

  // resize renderer
  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }

    return needResize;
  }

  let renderRequested = false;

  // render
  function render() {
    renderRequested = undefined; // renderRequested 변수를 초기화함.

    // 렌더러가 리사이즈되면 변경된 사이즈에 맞게 카메라 비율(aspect)도 업데이트 해줌
    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    // OrbitControls.update()는 enableDamping 값이 활성화되면 update loop 안에서 호출해줘야 함.
    controls.update();

    // 카메라가 움직이거나 해서 호출되면 매 프레임마다 카메라 위치가 변경될테니, 각 이름표의 Camera space 좌표값이 바뀔거고, 그에 따라 NDC 좌표값도 바뀔테니 그때마다 호출하여 각 이름표의 캔버스 위치값을 계산해 매번 할당해줘야 함.
    updateLabels();

    renderer.render(scene, camera);
  }
  render(); // 최초 페이지 로드 후 화면에 보여줄 이미지를 렌더해야 하니까 최초 호출을 한 번 해줌.

  function requestAnimateIfNotRequested() {
    if (!renderRequested) {
      renderRequested = true;
      requestAnimationFrame(render);
    }
  }

  controls.addEventListener('change', requestAnimateIfNotRequested);
  window.addEventListener('resize', requestAnimateIfNotRequested);
}

main();