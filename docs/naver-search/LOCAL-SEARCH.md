# 지역 검색 결과 조회

`Classic/VPC` Classic/VPC 환경에서 이용 가능합니다.

네이버 지역 서비스에 등록된 업체 및 기관을 검색한 결과를 조회합니다.

> **참고**
> 지역 검색은 검색 API를 사용하며, 검색 API의 하루 호출 한도는 25,000회입니다.

## 요청

요청 형식을 설명합니다. 요청 형식은 다음과 같습니다.

| 메서드 | URI |
|---|---|
| GET | `/search/v1/local` |

### 요청 헤더

NAVER API HUB에서 공통으로 사용하는 헤더에 대한 정보는 NAVER API HUB 요청 헤더를 참조해
주십시오.

### 요청 쿼리 파라미터

요청 쿼리 파라미터에 대한 설명은 다음과 같습니다.

| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `query` | String | Required | 검색어<br>- UTF-8로 인코딩 |
| `display` | Integer | Optional | 한 번에 표시할 검색 결과 개수<br>- 1 ~ 5 (기본값: 1) |
| `start` | Integer | Optional | 검색 시작 위치<br>- 1 |
| `sort` | String | Optional | 검색 결과 정렬 방법<br>- `random`(기본값) \| `comment`<br>  - `random`: 정확도 내림차순<br>  - `comment`: 업체·기관에 대한 카페·블로그의 리뷰 개수 내림차순 |
| `format` | String | Optional | 응답 형식<br>- `json`(기본값) \| `xml` |

### 요청 예시

요청 예시는 다음과 같습니다.

```shell
curl --location --request GET https://naverapihub.apigw.ntruss.com/search/v1/local \
--header X-NCP-APIGW-API-KEY-ID: {Client ID} \
--header X-NCP-APIGW-API-KEY: {Client Secret}
```

## 응답

응답 형식을 설명합니다.

### 응답 바디

응답 바디에 대한 설명은 다음과 같습니다.

| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `lastBuildDate` | String | - | 검색 결과를 생성한 시간 |
| `total` | Integer | - | 총 검색 결과 개수 |
| `start` | Integer | - | 검색 시작 위치 |
| `display` | Integer | - | 한 번에 표시할 검색 결과 개수 |
| `items` | Array | - | 개별 검색 결과 목록: [items](#items) |

#### items

`items`에 대한 설명은 다음과 같습니다.

| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `title` | String | - | 업체, 기관의 이름 |
| `link` | String | - | 업체, 기관의 상세 정보 URL |
| `category` | String | - | 업체, 기관의 분류 정보 |
| `description` | String | - | 업체, 기관에 대한 설명 |
| `telephone` | String | - | 값을 반환하지 않는 요소<br>- 하위 호환성 유지를 위해 존재 |
| `address` | String | - | 업체, 기관명의 지번 주소 |
| `roadAddress` | String | - | 업체, 기관명의 도로명 주소 |
| `mapx` | String | - | 업체, 기관이 위치한 장소의 x 좌표(WGS84 좌표계 기준) |
| `mapy` | String | - | 업체, 기관이 위치한 장소의 y 좌표(WGS84 좌표계 기준) |

### 응답 상태 코드

응답 상태 코드에 대한 설명은 다음과 같습니다.

| HTTP 상태 코드 | 코드 | 메시지 | 설명 |
|---|---|---|---|
| 400 | SE01 | Incorrect query request (잘못된 쿼리 요청입니다.) | API 요청 URL의 프로토콜, 파라미터 등에 오류가 있는지 확인 |
| 400 | SE02 | Invalid display value (부적절한 display 값입니다.) | `display` 값이 허용 범위인지 확인 |
| 400 | SE03 | Invalid start value (부적절한 start 값입니다.) | `start` 값이 허용 범위인지 확인 |
| 400 | SE04 | Invalid sort value (부적절한 sort 값입니다.) | `sort` 값에 오타가 있는지 확인 |
| 400 | SE06 | Malformed encoding (잘못된 형식의 인코딩입니다.) | 검색어를 UTF-8로 인코딩 |
| 404 | SE05 | Invalid search api (존재하지 않는 검색 api 입니다.) | API 요청 URL에 오타가 있는지 확인 |
| 500 | SE99 | System Error (시스템 에러) | 서버 내부에서 오류 발생 |

> **참고**
> NAVER API HUB에서 공통으로 사용하는 응답 상태 코드에 대한 설명은 NAVER API HUB 응답
> 상태 코드를 참조해 주십시오.

### 응답 예시

응답 예시는 다음과 같습니다.

```json
{
    "lastBuildDate": "Thu, 11 Jun 2026 19:41:08 +0900",
    "total": 5,
    "start": 1,
    "display": 2,
    "items": [
        {
            "title": "{업체명}",
            "link": "https://{업체 홈페이지}",
            "category": "카페,디저트>카페",
            "description": "",
            "telephone": "",
            "address": "{지번 주소}",
            "roadAddress": "{도로명 주소}",
            "mapx": "{경도}",
            "mapy": "{위도}"
        },
        {
            "title": "{업체명}",
            "link": "https://{업체 홈페이지}",
            "category": "카페,디저트>베이커리",
            "description": "",
            "telephone": "",
            "address": "{지번 주소}",
            "roadAddress": "{도로명 주소}",
            "mapx": "{경도}",
            "mapy": "{위도}"
        }
    ]
}
```
