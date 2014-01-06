var Shaderlib = (function() {

    var utils = {
        rand: [
            "float rand(vec2 co){",
            "    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);",
            "}",
        ].join("\n"),
        edge: [
            // from http://codeflow.org/entries/2012/aug/02/easy-wireframe-display-with-barycentric-coordinates/
            "float edgeFactor(vec3 edge) {",
                "vec3 d = fwidth(edge)+voxlineWidth;",
                "vec3 a3 = smoothstep(vec3(0.), d, edge);",
                "return min(min(a3.x, a3.y), a3.z);",
            "}",
        ].join("\n"),

        colormap: [
            "vec2 vnorm(vec4 values) {",
                "float range = vmax[0] - vmin[0];",
                "float norm0 = (values.x - vmin[0]) / range;",
                "float norm1 = (values.y - vmin[0]) / range;",
                "float fnorm0 = mix(norm0, norm1, framemix);",
            "#ifdef TWOD",
                "range = vmax[1] - vmin[1];",
                "norm0 = (values.z - vmin[1]) / range;",
                "norm1 = (values.w - vmin[1]) / range;",
                "float fnorm1 = mix(norm0, norm1, framemix);",
                "vec2 cuv = vec2(clamp(fnorm0, 0., 1.), clamp(fnorm1, 0., 1.) );",
            "#else",
                "vec2 cuv = vec2(clamp(fnorm0, 0., 1.), 0.);",
            "#endif",
                "return cuv;",
            "}",
            "vec4 colorlut(vec4 values) {",
                "vec2 cuv = vnorm(values);",
                "vec4 vColor = texture2D(colormap, cuv);",
                "bvec4 valid = notEqual(lessThanEqual(values, vec4(0.)), lessThan(vec4(0.), values));",
                "return all(valid) ? vColor : vec4(0.);",
            "}"
        ].join("\n"),

        pack: [
            "vec4 pack_float( const in float depth ) {",
                "const vec4 bit_shift = vec4( 256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0, 1.0 );",
                "const vec4 bit_mask  = vec4( 0.0, 1.0 / 256.0, 1.0 / 256.0, 1.0 / 256.0 );",
                "vec4 res = fract( depth * bit_shift );",
                "res -= res.xxyz * bit_mask;",
                "return floor(res * 256.) / 256. + 1./512.;",
            "}",
        ].join("\n"),

        samplers: [
            "vec2 make_uv_x(vec2 coord, float slice) {",
                "vec2 pos = vec2(mod(slice, mosaic[0].x), slice / mosaic[0].x);",
                "vec2 offset = (floor(pos) * (dshape[0]+1.)) + 1.;",
                "vec2 imsize = (mosaic[0] * (dshape[0]+1.)) + 1.;",
                "return (2.*(offset+coord)+1.) / (2.*imsize);",
            "}",

            "vec4 trilinear_x(sampler2D data, vec3 coord) {",
                "vec4 tex1 = texture2D(data, make_uv_x(coord.xy, floor(coord.z)));",
                "vec4 tex2 = texture2D(data, make_uv_x(coord.xy, ceil(coord.z)));",
                'return mix(tex1, tex2, fract(coord.z));',
            "}",

            "vec4 nearest_x(sampler2D data, vec3 coord) {",
                "return texture2D(data, make_uv_x(coord.xy, floor(coord.z+.5)));",
            "}",

            "vec4 debug_x(sampler2D data, vec3 coord) {",
                "return vec4(coord / vec3(136., 136., 38.), 1.);",
            "}",

            "vec2 make_uv_y(vec2 coord, float slice) {",
                "vec2 pos = vec2(mod(slice, mosaic[1].x), floor(slice / mosaic[1].x));",
                "vec2 offset = (pos * (dshape[1]+1.)) + 1.;",
                "vec2 imsize = (mosaic[1] * (dshape[1]+1.)) + 1.;",
                "return (2.*(offset+coord)+1.) / (2.*imsize);",
            "}",

            "vec4 trilinear_y(sampler2D data, vec3 coord) {",
                "vec4 tex1 = texture2D(data, make_uv_y(coord.xy, floor(coord.z)));",
                "vec4 tex2 = texture2D(data, make_uv_y(coord.xy, ceil(coord.z)));",
                'return mix(tex1, tex2, fract(coord.z));',
            "}",

            "vec4 nearest_y(sampler2D data, vec3 coord) {",
                "return texture2D(data, make_uv_y(coord.xy, floor(coord.z+.5)));",
            "}",

            "vec4 debug_y(sampler2D data, vec3 coord) {",
                "return vec4(coord / vec3(100., 100., 32.), 1.);",
            "}",
        ].join("\n"),

        standard_frag_vars: [
            "uniform vec3 diffuse;",
            "uniform vec3 ambient;",
            "uniform vec3 emissive;",
            "uniform vec3 specular;",
            "uniform float shininess;",
            "uniform float specularStrength;",

            "uniform sampler2D colormap;",
            "uniform float vmin[2];",
            "uniform float vmax[2];",
            "uniform float framemix;",

            "uniform vec3 voxlineColor;",
            "uniform float voxlineWidth;",
            "uniform float dataAlpha;",

            "uniform vec2 mosaic[2];",
            "uniform vec2 dshape[2];",
            "uniform sampler2D data[4];",
        ].join("\n"),

        mixer: function(morphs) {
            var glsl = "uniform float surfmix;\n";
            for (var i = 0; i < morphs-1; i++) {
                glsl += "attribute vec3 mixSurfs"+i+";\n";
                glsl += "attribute vec3 mixNorms"+i+";\n";
            }
            glsl += [
            "void mixfunc(vec3 basepos, vec3 basenorm, out vec3 pos, out vec3 norm) {",
                "float smix = surfmix * "+(morphs-1)+".;",
                "float factor = clamp(1. - smix, 0., 1.);",
                "pos = factor * basepos;",
                "norm = factor * basenorm;",
                "",
            ].join("\n");
            for (var i = 0; i < morphs-1; i++) {
                glsl += "factor = clamp( 1. - abs(smix - "+(i+1)+".) , 0., 1.);\n";
                glsl += "pos  += factor * mixSurfs"+i+";\n";
                glsl += "norm += factor * mixNorms"+i+";\n";
            }
            glsl += [ "",
            "}",
            "void mixfunc_pos(vec3 basepos, out vec3 pos) {",
                "float smix = surfmix * "+(morphs-1)+".;",
                "float factor = clamp(1. - smix, 0., 1.);",
                "pos = factor * basepos;",
            ].join("\n");
            for (var i = 0; i < morphs-1; i++) {
                glsl += "factor = clamp( 1. - abs(smix - "+(i+1)+".) , 0., 1.);\n";
                glsl += "pos  += factor * mixSurfs"+i+";\n";
            }
            glsl += [ "",
            "}",
            ].join("\n");
            return glsl;
        }
    }

    var module = function() {

    };
    module.prototype = {
        constructor: module,
        main: function(sampler, raw, twod, voxline, opts) {
            //Creates shader code with all the parameters
            //sampler: which sampler to use, IE nearest or trilinear
            //raw: whether the dataset is raw or not
            //voxline: whether to show the voxel lines
            
            var header = "";
            if (voxline)
                header += "#define VOXLINE\n";
            if (raw)
                header += "#define RAWCOLORS\n";
            if (twod)
                header += "#define TWOD\n";

            var vertShade =  [
            THREE.ShaderChunk[ "lights_phong_pars_vertex" ],

            "uniform mat4 volxfm[2];",

            "attribute vec4 auxdat;",

            "varying vec3 vViewPosition;",
            "varying vec3 vNormal;",

            "varying vec3 vPos_x;",
        "#ifdef TWOD",
            "varying vec3 vPos_y;",
        "#endif",

            "void main() {",

                "vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );",
                "vViewPosition = -mvPosition.xyz;",

                //Find voxel positions with both transforms (2D colormap x and y datasets)
                "vPos_x = (volxfm[0]*vec4(position,1.)).xyz;",
        "#ifdef TWOD",
                "vPos_y = (volxfm[1]*vec4(position,1.)).xyz;",
        "#endif",

                "vNormal = normalMatrix * normal;",
                "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0);",

            "}"
            ].join("\n");

            var fragShade = [
            "#extension GL_OES_standard_derivatives: enable",
            "#extension GL_OES_texture_float: enable",

            "varying vec3 vPos_x;",
            "varying vec3 vPos_y;",

            THREE.ShaderChunk[ "lights_phong_pars_fragment" ],
            
            utils.standard_frag_vars,
            utils.rand,
            utils.edge,
            utils.colormap,
            utils.samplers,

            "void main() {",
            "#ifdef RAWCOLORS",
                "vec4 color[2]; color[0] = vec4(0.), color[1] = vec4(0.);",
            "#else",
                "vec4 values = vec4(0.);",
            "#endif",
        
        "#ifdef RAWCOLORS",
                "color[0] += "+sampler+"_x(data[0], vPos_x);",
                "color[1] += "+sampler+"_x(data[1], vPos_x);",
        "#else",
                "values.x += "+sampler+"_x(data[0], vPos_x).r;",
                "values.y += "+sampler+"_x(data[1], vPos_x).r;",
            "#ifdef TWOD",
                "values.z += "+sampler+"_y(data[2], vPos_y).r;",
                "values.w += "+sampler+"_y(data[3], vPos_y).r;",
            "#endif",
        "#endif",

            "#ifdef RAWCOLORS",
                "vec4 vColor = mix(color[0], color[1], framemix);",
            "#else",
                "vec4 vColor = colorlut(values);",
            "#endif",
                "vColor *= dataAlpha;",

        "#ifdef VOXLINE",
                "vec3 coord = vPos_x[0];",
                "vec3 edge = abs(fract(coord) - vec3(0.5));",
                "vColor = mix(vec4(voxlineColor, 1.), vColor, edgeFactor(edge*1.001));",
        "#endif",

                "if (vColor.a < .001) discard;",
                "gl_FragColor = vColor;",

                THREE.ShaderChunk[ "lights_phong_fragment" ],
            "}"
            ].join("\n");

            return {vertex:header+vertShade, fragment:header+fragShade};
        },
        halopoint: function(sampler, raw, twod, voxline, opts) {
            var header = "#define CORTSHEET\n";
            if (raw)
                header += "#define RAWCOLORS\n";
            if (twod)
                header += "#define TWOD\n";

            var morphs = opts.morphs;
            var vertShade =  [
            "uniform vec2 screen_size;",
            "uniform mat4 volxfm[2];",
            "attribute vec3 position2;",
            "attribute vec4 auxdat;",
            "varying float vMedial;",

            "varying vec3 vPos_x;",
        "#ifdef TWOD",
            "varying vec3 vPos_y;",
        "#endif",
            "varying float vDist;",

            utils.mixer(morphs),

            "void main() {",
                //Find voxel positions with both transforms (2D colormap x and y datasets)
                "vPos_x = (volxfm[0]*vec4(position,1.)).xyz;",
            "#ifdef TWOD",
                "vPos_y = (volxfm[1]*vec4(position,1.)).xyz;",
            "#endif",

                "vMedial = auxdat.x;",

                "vec3 pos;",
                "mixfunc_pos(position2, pos);",

                //compute the screen distance between pial and white matter surfaces
                "vec4 spos1 = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "vec4 spos2 = projectionMatrix * modelViewMatrix * vec4(position2, 1.0);",
                //perspective divide
                "vec2 snorm1 = screen_size * (spos1.xy / spos1.w);",
                "vec2 snorm2 = screen_size * (spos2.xy / spos2.w);",

                "vDist = distance(position, position2);",

                //return pixel-sized pointsize
                "gl_PointSize = distance(snorm1, snorm2);",
                "gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);",

            "}"
            ].join("\n");

            var sampling = [
        "#ifdef RAWCOLORS",
                "color[0] += "+sampler+"_x(data[0], coord_x);",
                "color[1] += "+sampler+"_x(data[1], coord_x);",
        "#else",
                "values.x += "+sampler+"_x(data[0], coord_x).r;",
                "values.y += "+sampler+"_x(data[1], coord_x).r;",
            "#ifdef TWOD",
                "values.z += "+sampler+"_y(data[2], coord_y).r;",
                "values.w += "+sampler+"_y(data[3], coord_y).r;",
            "#endif",
        "#endif",
            ].join("\n");

            var fragShade = [
            "#extension GL_OES_standard_derivatives: enable",
            "#extension GL_OES_texture_float: enable",

            "uniform float surfmix;",
            "uniform mat4 inverse;",
            "varying float vMedial;",

            "varying vec3 vPos_x;",
            "varying vec3 vPos_y;",
            "varying float vDist;",

            utils.standard_frag_vars,
            utils.rand,
            utils.colormap,

            utils.samplers,

            "void main() {",
                "vec3 coord_x, coord_y;",
            "#ifdef RAWCOLORS",
                "vec4 color[2]; color[0] = vec4(0.), color[1] = vec4(0.);",
            "#else",
                "vec4 values = vec4(0.);",
            "#endif",
                
                "vec4 offset = inverse * vec4((vec2(2.)*gl_PointCoord - vec2(1.)) * vec2(vDist), 0., 1.);",
                "coord_x = vPos_x + offset.xyz;",
            "#ifdef TWOD",
                "coord_y = vPos_y + offset.xyz;",
            "#endif",

                sampling,

            "#ifdef RAWCOLORS",
                "vec4 vColor = mix(color[0], color[1], framemix);",
            "#else",
                "vec4 vColor = colorlut(values);",
            "#endif",
                "vColor *= dataAlpha;",

                "if (vMedial < .999) {",
                    "gl_FragColor = vec4(offset.xyz, 1.);",
                "} else if (surfmix > "+((morphs-2)/(morphs-1))+") {",
                    "discard;",
                "}",
            "}"
            ].join("\n");

            var attributes = {
                position2: { type: 'v3', value:null },
                auxdat: { type: 'v4', value:null },
            };
            for (var i = 0; i < morphs-1; i++) {
                attributes['mixSurfs'+i] = { type:'v3', value:null};
                attributes['mixNorms'+i] = { type:'v3', value:null};
            }

            return {vertex:header+vertShade, fragment:header+fragShade, attrs:attributes};
        },

        halosprite: function(sampler, raw, twod, voxline, opts) {
            var header = "#define CORTSHEET\n";
            if (raw)
                header += "#define RAWCOLORS\n";
            if (twod)
                header += "#define TWOD\n";

            var morphs = opts.morphs;
            var vertShade =  [
            "uniform vec2 screen_size;",
            "uniform mat4 volxfm[2];",
            "attribute vec3 position2;",
            "attribute vec4 auxdat;",
            "varying float vMedial;",

            "varying vec3 vPos_x;",
        "#ifdef TWOD",
            "varying vec3 vPos_y;",
        "#endif",
            "varying float vDist;",

            utils.mixer(morphs),

            "void main() {",
                //Find voxel positions with both transforms (2D colormap x and y datasets)
                "vPos_x = (volxfm[0]*vec4(position,1.)).xyz;",
            "#ifdef TWOD",
                "vPos_y = (volxfm[1]*vec4(position,1.)).xyz;",
            "#endif",

                "vMedial = auxdat.x;",

                "vec3 pos;",
                "mixfunc_pos(position2, pos);",

                //compute the screen distance between pial and white matter surfaces
                "vec4 spos1 = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "vec4 spos2 = projectionMatrix * modelViewMatrix * vec4(position2, 1.0);",
                //perspective divide
                "vec2 snorm1 = screen_size * (spos1.xy / spos1.w);",
                "vec2 snorm2 = screen_size * (spos2.xy / spos2.w);",

                "vDist = distance(position, position2);",

                //return pixel-sized pointsize
                "gl_PointSize = distance(snorm1, snorm2);",
                "gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);",

            "}"
            ].join("\n");

            var sampling = [
        "#ifdef RAWCOLORS",
                "color[0] += "+sampler+"_x(data[0], coord_x);",
                "color[1] += "+sampler+"_x(data[1], coord_x);",
        "#else",
                "values.x += "+sampler+"_x(data[0], coord_x).r;",
                "values.y += "+sampler+"_x(data[1], coord_x).r;",
            "#ifdef TWOD",
                "values.z += "+sampler+"_y(data[2], coord_y).r;",
                "values.w += "+sampler+"_y(data[3], coord_y).r;",
            "#endif",
        "#endif",
            ].join("\n");

            var fragShade = [
            "#extension GL_OES_standard_derivatives: enable",
            "#extension GL_OES_texture_float: enable",

            "uniform float surfmix;",
            "uniform mat4 inverse;",
            "varying float vMedial;",

            "varying vec3 vPos_x;",
            "varying vec3 vPos_y;",
            "varying float vDist;",

            utils.standard_frag_vars,
            utils.rand,
            utils.colormap,

            utils.samplers,

            "void main() {",
                "vec3 coord_x, coord_y;",
            "#ifdef RAWCOLORS",
                "vec4 color[2]; color[0] = vec4(0.), color[1] = vec4(0.);",
            "#else",
                "vec4 values = vec4(0.);",
            "#endif",
                
                "vec4 offset = inverse * vec4((vec2(2.)*gl_PointCoord - vec2(1.)) * vec2(vDist), 0., 1.);",
                "coord_x = vPos_x + offset.xyz;",
            "#ifdef TWOD",
                "coord_y = vPos_y + offset.xyz;",
            "#endif",

                sampling,

            "#ifdef RAWCOLORS",
                "vec4 vColor = mix(color[0], color[1], framemix);",
            "#else",
                "vec4 vColor = colorlut(values);",
            "#endif",
                "vColor *= dataAlpha;",

                "if (vMedial < .999) {",
                    "gl_FragColor = vec4(offset.xyz, 1.);",
                "} else if (surfmix > "+((morphs-2)/(morphs-1))+") {",
                    "discard;",
                "}",
            "}"
            ].join("\n");

            var attributes = {
                position2: { type: 'v3', value:null },
                auxdat: { type: 'v4', value:null },
            };
            for (var i = 0; i < morphs-1; i++) {
                attributes['mixSurfs'+i] = { type:'v3', value:null};
                attributes['mixNorms'+i] = { type:'v3', value:null};
            }

            return {vertex:header+vertShade, fragment:header+fragShade, attrs:attributes};
        },

        surface: function(sampler, raw, twod, voxline, opts) {
            var header = "";
            if (voxline)
                header += "#define VOXLINE\n";
            if (raw)
                header += "#define RAWCOLORS\n";
            if (twod)
                header += "#define TWOD\n";

            var morphs = opts.morphs;
            var volume = opts.volume || 0;
            if (volume > 0)
                header += "#define CORTSHEET\n";
            if (opts.rois)
                header += "#define ROI_RENDER\n";
            if (sampler !== null)
                header += "#define VOLUME_SAMPLED\n";
            if (opts.halo) {
                if (twod)
                    throw "Cannot use 2D colormaps with volume integration"
                header += "#define HALO_RENDER\n";
            }

            var vertShade =  [
            THREE.ShaderChunk[ "lights_phong_pars_vertex" ],
            "uniform mat4 volxfm[2];",

            "uniform float thickmix;",
            "attribute vec3 position2;",
            "attribute vec3 normal2;",

            "attribute vec4 auxdat;",
            // "attribute float dropout;",
            
            "varying vec2 vUv;",
            "varying float vCurv;",
            // "varying float vDrop;",
            "varying float vMedial;",

            "varying vec3 vViewPosition;",
            "varying vec3 vNormal;",

            "varying vec3 vPos_x[2];",
        "#ifdef TWOD",
            "varying vec3 vPos_y[2];",
        "#endif",

            utils.mixer(morphs),

            "void main() {",

                "vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );",
                "vViewPosition = -mvPosition.xyz;",

                //Find voxel positions with both transforms (2D colormap x and y datasets)
    "#ifdef VOLUME_SAMPLED",
                "vPos_x[0] = (volxfm[0]*vec4(position,1.)).xyz;",
            "#ifdef TWOD",
                "vPos_y[0] = (volxfm[1]*vec4(position,1.)).xyz;",
            "#endif",
        "#ifdef CORTSHEET",
                "vPos_x[1] = (volxfm[0]*vec4(position2,1.)).xyz;",
            "#ifdef TWOD",
                "vPos_y[1] = (volxfm[1]*vec4(position2,1.)).xyz;",
            "#endif",
        "#endif",
    "#endif",
        "#ifdef CORTSHEET",
                "vec3 mpos = mix(position, position2, thickmix);",
                "vec3 mnorm = mix(normal, normal2, thickmix);",
        "#else",
                "vec3 npos = position;",
                "vec3 mnorm = normal;",
        "#endif",

                //Overlay
            "#ifdef ROI_RENDER",
                "vUv = uv;",
            "#endif",

                // "vDrop = dropout;",
                "vMedial = auxdat.x;",
                "vCurv = auxdat.y;",

                "vec3 pos, norm;",
                "mixfunc(mpos, mnorm, pos, norm);",

            "#ifdef CORTSHEET",
                "pos += clamp(surfmix*"+(morphs-1)+"., 0., 1.) * normalize(norm) * .62 * distance(position, position2) * mix(1., 0., thickmix);",
            "#endif",

                "vNormal = normalMatrix * norm;",
                "gl_Position = projectionMatrix * modelViewMatrix * vec4( pos, 1.0 );",

            "}"
            ].join("\n");

            var fragHead = [
            "#extension GL_OES_standard_derivatives: enable",
            "#extension GL_OES_texture_float: enable",

            THREE.ShaderChunk[ "lights_phong_pars_fragment" ],

        "#ifdef ROI_RENDER",
            "varying vec2 vUv;",
            "uniform sampler2D overlay;",
        "#endif",

            "uniform float surfmix;",
            "uniform float curvAlpha;",
            "uniform float curvScale;",
            "uniform float curvLim;",
            "uniform float hatchAlpha;",
            "uniform vec3 hatchColor;",
            "uniform sampler2D hatch;",
            "uniform vec2 hatchrep;",

            "varying float vCurv;",
            // "varying float vDrop;",
            "varying float vMedial;",

            "uniform float thickmix;",

            "varying vec3 vPos_x[2];",
            "varying vec3 vPos_y[2];",

            utils.standard_frag_vars,
            utils.rand,
            utils.edge,
            utils.colormap,

        "#ifdef VOLUME_SAMPLED",
            utils.samplers,
        "#endif",

            "void main() {",
                //Curvature Underlay
                "float curv = clamp(vCurv / curvScale  + .5, curvLim, 1.-curvLim);",
                "vec4 cColor = vec4(vec3(curv) * curvAlpha, curvAlpha);",

                "vec3 coord_x, coord_y;",
            "#ifdef RAWCOLORS",
                "vec4 color[2]; color[0] = vec4(0.), color[1] = vec4(0.);",
            "#else",
                "vec4 values = vec4(0.);",
            "#endif",
                "",
            ].join("\n");

            //Create samplers for texture volume sampling
            var fragMid = "";
            if (sampler !== null) {            
                var factor = volume > 1 ? (1/volume).toFixed(6) : "1.";
                var sampling = [
            "#ifdef RAWCOLORS",
                    "color[0] += "+factor+"*"+sampler+"_x(data[0], coord_x);",
                    "color[1] += "+factor+"*"+sampler+"_x(data[1], coord_x);",
            "#else",
                    "values.x += "+factor+"*"+sampler+"_x(data[0], coord_x).r;",
                    "values.y += "+factor+"*"+sampler+"_x(data[1], coord_x).r;",
                "#ifdef TWOD",
                    "values.z += "+factor+"*"+sampler+"_y(data[2], coord_y).r;",
                    "values.w += "+factor+"*"+sampler+"_y(data[3], coord_y).r;",
                "#endif",
            "#endif",
                ].join("\n");

                if (volume == 0) {
                    fragMid += [
                        "coord_x = vPos_x[0];",
                    "#ifdef TWOD",
                        "coord_y = vPos_y[0];",
                    "#endif",
                        sampling,
                        ""
                    ].join("\n");
                } else if (volume == 1) {
                    fragMid += [
                        "coord_x = mix(vPos_x[0], vPos_x[1], thickmix);",
                    "#ifdef TWOD",
                        "coord_y = mix(vPos_y[0], vPos_y[1], thickmix);",
                    "#endif",
                        sampling,
                        "",
                    ].join("\n");
                } else {
                    fragMid += "vec2 rseed;\nfloat randval;\n";
                    for (var i = 0; i < volume; i++) {
                        fragMid += [
                            "rseed = gl_FragCoord.xy + vec2(2.34*"+i.toFixed(3)+", 3.14*"+i.toFixed(3)+");",
                            "randval = rand(rseed);",
                            "coord_x = mix(vPos_x[0], vPos_x[1], randval);",
                        "#ifdef TWOD",
                            "coord_y = mix(vPos_y[0], vPos_y[1], randval);",
                        "#endif",
                            sampling,
                            "", 
                        ].join("\n");
                    }
                }
            }

            var fragTail = [
    "#ifdef HALO_RENDER",
                "float value = vnorm(values).x;",
                "const vec3 bit_shift = vec3( 511./64., 511./8., 511.);", //3 bits per color
                "const vec3 bit_mask  = vec3( 0., 8., 8.);",
                "vec3 res = floor( value * bit_shift );",
                "res -= res.xxy * bit_mask;",
                "if (vMedial < .999) {",
                    //"gl_FragColor = vec4(1. / 256., 0., 0., 1.);",
                    "gl_FragColor = vec4(res / 256., 1. / 256.);",
                    //"gl_FragColor = vec4(vec3(value / 32.), 1.);",
                "} else if (surfmix > "+((morphs-2)/(morphs-1))+") {",
                    "discard;",
                "}",
    "#else",
        "#ifdef VOLUME_SAMPLED",
            "#ifdef RAWCOLORS",
                "vec4 vColor = mix(color[0], color[1], framemix);",
            "#else",
                "vec4 vColor = colorlut(values);",
            "#endif",
                "vColor *= dataAlpha;",
                //"vColor.a = (values.x - vmin[0]) / (vmax[0] - vmin[0]);",
        "#else",
            "vec4 vColor = vec4(0.);",
        "#endif",

        "#ifdef VOXLINE",
            "#ifdef CORTSHEET",
                "vec3 coord = mix(vPos_x[0], vPos_x[1], thickmix);",
            "#else",
                "vec3 coord = vPos_x[0];",
            "#endif",
                "vec3 edge = abs(fract(coord) - vec3(0.5));",
                "vColor = mix(vec4(voxlineColor, 1.), vColor, edgeFactor(edge*1.001));",
        "#endif",

                //Cross hatch / dropout layer
                // "float hw = gl_FrontFacing ? hatchAlpha*vDrop : 1.;",
                // "vec4 hColor = hw * vec4(hatchColor, 1.) * texture2D(hatch, vUv*hatchrep);",

                //roi layer
            "#ifdef ROI_RENDER",
                "vec4 rColor = texture2D(overlay, vUv);",
            "#endif",          

        "#ifdef SUBJ_SURF",
                "if (vMedial < .999) {",
                    "gl_FragColor = cColor;",
                    "gl_FragColor = vColor + (1.-vColor.a)*gl_FragColor;",
                    // "gl_FragColor = hColor + (1.-hColor.a)*gl_FragColor;",
            "#ifdef ROI_RENDER",
                    "gl_FragColor = rColor + (1.-rColor.a)*gl_FragColor;",
            "#endif",
                "} else if (surfmix > "+((morphs-2)/(morphs-1))+") {",
                    "discard;",
                "} else {",
                    "gl_FragColor = cColor;",
                "}",
        "#else",
                "if (vColor.a < .01) discard;",
                "gl_FragColor = vColor;",
        "#endif",
            "} else if (hide_mwall == 1) {",
                "discard;",
            "} else {",
                "gl_FragColor = cColor;",
            "}",
                THREE.ShaderChunk[ "lights_phong_fragment" ],
    "#endif",
            "}"
            ].join("\n");

            var attributes = {
                position2: { type: 'v3', value:null },
                normal2: { type: 'v3', value:null },
                auxdat: { type: 'v4', value:null },
            };
            for (var i = 0; i < morphs-1; i++) {
                attributes['mixSurfs'+i] = { type:'v3', value:null};
                attributes['mixNorms'+i] = { type:'v3', value:null};
            }

            return {vertex:header+vertShade, fragment:header+fragHead+fragMid+fragTail, attrs:attributes};
        },

        cmap_quad: function() {
            //Colormaps the full-screen quad, used for stage 2 of volume integration
            var vertShade = [
                "void main() {",
                    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
                "}",
            ].join("\n");
            var fragShade = [
                "uniform vec2 screen_size;",
                "uniform sampler2D screen;",
                "uniform sampler2D colormap;",
                "void main() {",
                    "vec4 value = texture2D(screen, gl_FragCoord.xy / screen_size);",
                    "const vec3 bit_shift = vec3(256. * 64. / 511., 256.*8. / 511., 256. / 511.);",
                    "float raw = dot(bit_shift, value.rgb) / (value.a*256.);",
                    //"if (value.a > 0.) {",
                       "gl_FragColor = texture2D(colormap, vec2(raw, 0.));",
                    //"} else {",
                    //   "discard;",
                    //"}",
                    //"gl_FragColor = vec4(vec3(raw), 1.);",
                    //"gl_FragColor = vec4(value.rgb, 1.);",
                "}",
            ].join("\n");
            return {vertex:vertShade, fragment:fragShade, attrs:{}};
        },
        
        pick: function() {
            var vertShade = [
                "attribute vec4 auxdat;",
                "varying vec3 vPos;",
                "varying float vMedial;",
                THREE.ShaderChunk[ "morphtarget_pars_vertex" ],
                "void main() {",
                    "vPos = position;",
                    "vMedial = auxdat.x;",
                    THREE.ShaderChunk[ "morphtarget_vertex" ],
                "}",
            ].join("\n");

            var fragShades = [];
            var dims = ['x', 'y', 'z'];
            for (var i = 0; i < 3; i++){
                var dim = dims[i];
                var shade = [
                "uniform vec3 min;",
                "uniform vec3 max;",
                "uniform int hide_mwall;",
                "varying vec3 vPos;",
                "varying float vMedial;",
                utils.pack,
                "void main() {",
                    "float norm = (vPos."+dim+" - min."+dim+") / (max."+dim+" - min."+dim+");", 
                    "if (vMedial > .999 && hide_mwall == 1)",
                        "discard;",
                    "else",
                        "gl_FragColor = pack_float(norm);",
                "}"
                ].join("\n");
                fragShades.push(shade);
            }

            return {vertex:vertShade, fragment:fragShades};
        },
    };

    return module;
})();

var Shaders = new Shaderlib();